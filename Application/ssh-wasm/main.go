// The web terminal's SSH client (Architecture/admin-and-identity-design.md,
// A16), compiled to WebAssembly for the edit origin's terminal.
//
// It borrows everything it can. golang.org/x/crypto/ssh is the SSH client,
// and github.com/coder/websocket carries it over the browser's WebSocket to
// the site's relay, which only forwards bytes. The private key never enters
// this program: it is a non-extractable WebCrypto key, and every signature
// is asked of the page, which asks WebCrypto.
//
// It adds one function to the page:
//
//	pcSsh.connect({
//	  url:       the relay's wss:// address, with its one-time ticket
//	  addr:      "host:port", for the SSH handshake's record
//	  user:      the login name
//	  publicKey: the Ed25519 public key, 32 raw bytes (Uint8Array)
//	  sign:      data (Uint8Array) => Promise<Uint8Array>, the 64-byte signature
//	  hostKeys:  the destination's keys, each an authorized_keys line
//	  cols, rows, term
//	  command:   what to run in the pty instead of the login shell, if anything
//	  onData:    bytes (Uint8Array) from the far end's terminal
//	  onClose:   message (string), empty when the far end ended the session
//	}) => Promise<{ write(bytes or string), resize(cols, rows), close() }>
//
// A host key not on the list ends the connection before anything is sent.
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"syscall/js"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/crypto/ssh"
)

func main() {
	api := js.Global().Get("Object").New()
	api.Set("connect", js.FuncOf(connect))
	js.Global().Set("pcSsh", api)
	select {} // stay alive; the page calls in
}

// jsError makes a JavaScript Error, so the page's catch sees a message.
func jsError(err error) js.Value {
	return js.Global().Get("Error").New(err.Error())
}

// promise runs work on a goroutine of its own, where blocking is allowed,
// and settles a JavaScript Promise with what it returns.
func promise(work func() (js.Value, error)) js.Value {
	var executor js.Func
	executor = js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			defer executor.Release()
			v, err := work()
			if err != nil {
				reject.Invoke(jsError(err))
				return
			}
			resolve.Invoke(v)
		}()
		return nil
	})
	return js.Global().Get("Promise").New(executor)
}

// await waits for a JavaScript Promise. It must be called from a goroutine
// of our own, never from inside a callback the page made.
func await(p js.Value) (js.Value, error) {
	type result struct {
		v   js.Value
		err error
	}
	ch := make(chan result, 1)
	var ok, fail js.Func
	ok = js.FuncOf(func(this js.Value, args []js.Value) any {
		ch <- result{v: args[0]}
		return nil
	})
	fail = js.FuncOf(func(this js.Value, args []js.Value) any {
		msg := "the browser refused"
		if len(args) > 0 && args[0].Truthy() {
			msg = args[0].Call("toString").String()
		}
		ch <- result{err: errors.New(msg)}
		return nil
	})
	defer ok.Release()
	defer fail.Release()
	p.Call("then", ok, fail)
	r := <-ch
	return r.v, r.err
}

func bytesOf(v js.Value) []byte {
	b := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(b, v)
	return b
}

func toJS(b []byte) js.Value {
	u := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(u, b)
	return u
}

// browserSigner is an ssh.Signer whose private key stays in the browser.
type browserSigner struct {
	pub  ssh.PublicKey
	sign js.Value
}

func (s *browserSigner) PublicKey() ssh.PublicKey { return s.pub }

func (s *browserSigner) Sign(_ io.Reader, data []byte) (*ssh.Signature, error) {
	v, err := await(s.sign.Invoke(toJS(data)))
	if err != nil {
		return nil, fmt.Errorf("signing: %w", err)
	}
	sig := bytesOf(v)
	if len(sig) != ed25519.SignatureSize {
		return nil, errors.New("signing: the browser's signature is the wrong size")
	}
	return &ssh.Signature{Format: ssh.KeyAlgoED25519, Blob: sig}, nil
}

// pinned accepts only the host keys the site's configuration lists, and
// offers only their algorithms, so the server presents one of them.
func pinned(lines js.Value) (ssh.HostKeyCallback, []string, error) {
	var keys []ssh.PublicKey
	var algos []string
	for i := 0; i < lines.Get("length").Int(); i++ {
		k, _, _, _, err := ssh.ParseAuthorizedKey([]byte(lines.Index(i).String()))
		if err != nil {
			return nil, nil, fmt.Errorf("a pinned host key doesn't parse: %w", err)
		}
		keys = append(keys, k)
		algos = append(algos, algorithmsFor(k.Type())...)
	}
	if len(keys) == 0 {
		return nil, nil, errors.New("the destination has no pinned host key")
	}
	cb := func(_ string, _ net.Addr, got ssh.PublicKey) error {
		for _, k := range keys {
			if bytes.Equal(k.Marshal(), got.Marshal()) {
				return nil
			}
		}
		return fmt.Errorf("the host key %s is not the one pinned for this destination", ssh.FingerprintSHA256(got))
	}
	return cb, algos, nil
}

// algorithmsFor lists the signature algorithms a host key of this type may
// use; an RSA key signs with SHA-2 in current OpenSSH.
func algorithmsFor(keyType string) []string {
	if keyType == ssh.KeyAlgoRSA {
		return []string{ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256}
	}
	return []string{keyType}
}

func connect(this js.Value, args []js.Value) any {
	o := args[0]
	return promise(func() (js.Value, error) {
		pub, err := ssh.NewPublicKey(ed25519.PublicKey(bytesOf(o.Get("publicKey"))))
		if err != nil {
			return js.Undefined(), err
		}
		hostCB, algos, err := pinned(o.Get("hostKeys"))
		if err != nil {
			return js.Undefined(), err
		}
		onData, onClose := o.Get("onData"), o.Get("onClose")

		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		ws, _, err := websocket.Dial(ctx, o.Get("url").String(), nil)
		cancel()
		if err != nil {
			return js.Undefined(), fmt.Errorf("the relay: %w", err)
		}
		ws.SetReadLimit(1 << 20)
		conn := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)

		cfg := &ssh.ClientConfig{
			User:              o.Get("user").String(),
			Auth:              []ssh.AuthMethod{ssh.PublicKeys(&browserSigner{pub: pub, sign: o.Get("sign")})},
			HostKeyCallback:   hostCB,
			HostKeyAlgorithms: algos,
			Timeout:           20 * time.Second,
		}
		sc, chans, reqs, err := ssh.NewClientConn(conn, o.Get("addr").String(), cfg)
		if err != nil {
			conn.Close()
			return js.Undefined(), err
		}
		client := ssh.NewClient(sc, chans, reqs)
		sess, err := client.NewSession()
		if err != nil {
			client.Close()
			return js.Undefined(), err
		}
		term := o.Get("term").String()
		if term == "" || term == "<undefined>" {
			term = "xterm-256color"
		}
		modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
		if err := sess.RequestPty(term, o.Get("rows").Int(), o.Get("cols").Int(), modes); err != nil {
			client.Close()
			return js.Undefined(), err
		}
		stdin, err := sess.StdinPipe()
		if err != nil {
			client.Close()
			return js.Undefined(), err
		}
		stdout, _ := sess.StdoutPipe()
		stderr, _ := sess.StderrPipe()
		pump := func(r io.Reader) {
			buf := make([]byte, 32*1024)
			for {
				n, err := r.Read(buf)
				if n > 0 {
					onData.Invoke(toJS(buf[:n]))
				}
				if err != nil {
					return
				}
			}
		}
		go pump(stdout)
		go pump(stderr)
		// A destination may name a command to run on arrival, in the pty,
		// as ssh -t host command does; otherwise it is the login shell.
		if cmd := o.Get("command"); cmd.Type() == js.TypeString && cmd.String() != "" {
			err = sess.Start(cmd.String())
		} else {
			err = sess.Shell()
		}
		if err != nil {
			client.Close()
			return js.Undefined(), err
		}
		go func() {
			err := sess.Wait()
			client.Close()
			msg := ""
			var exit *ssh.ExitError
			if err != nil && !errors.As(err, &exit) {
				msg = err.Error()
			}
			onClose.Invoke(msg)
		}()

		// Keystrokes go out in order through one writer. The page's handler
		// only queues them, since a callback from the page must not block.
		in := newQueue()
		go func() {
			for {
				b, ok := in.next()
				if !ok {
					return
				}
				if _, err := stdin.Write(b); err != nil {
					return
				}
			}
		}()

		// The session's handle. Its methods are called from the page's
		// event handlers, so anything that may block runs on a goroutine.
		h := js.Global().Get("Object").New()
		h.Set("write", js.FuncOf(func(this js.Value, a []js.Value) any {
			if a[0].Type() == js.TypeString {
				in.put([]byte(a[0].String()))
			} else {
				in.put(bytesOf(a[0]))
			}
			return nil
		}))
		h.Set("resize", js.FuncOf(func(this js.Value, a []js.Value) any {
			cols, rows := a[0].Int(), a[1].Int()
			go sess.WindowChange(rows, cols)
			return nil
		}))
		h.Set("close", js.FuncOf(func(this js.Value, a []js.Value) any {
			in.close()
			go client.Close()
			return nil
		}))
		return h, nil
	})
}

// queue is an unbounded, ordered hand-off from the page's callbacks, which
// must never block, to the one goroutine that writes to the session.
type queue struct {
	mu     sync.Mutex
	items  [][]byte
	closed bool
	wake   chan struct{}
}

func newQueue() *queue { return &queue{wake: make(chan struct{}, 1)} }

func (q *queue) signal() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

func (q *queue) put(b []byte) {
	q.mu.Lock()
	if !q.closed {
		q.items = append(q.items, b)
	}
	q.mu.Unlock()
	q.signal()
}

func (q *queue) close() {
	q.mu.Lock()
	q.closed = true
	q.mu.Unlock()
	q.signal()
}

func (q *queue) next() ([]byte, bool) {
	for {
		q.mu.Lock()
		if len(q.items) > 0 {
			b := q.items[0]
			q.items = q.items[1:]
			q.mu.Unlock()
			return b, true
		}
		closed := q.closed
		q.mu.Unlock()
		if closed {
			return nil, false
		}
		<-q.wake
	}
}
