/* Lookup and source management share the scanner's addressable applet state. */
(function () {
    'use strict';
    window.pcBarcodeLookupUI = function (root, opts) {
        var L = window.pcBarcodeLookup, view = 'decode', source = '', edit = '', users = [], loadError = '', outcome = null,
            controller, revision = 0, deadline, cooldowns = new Map(), destroyed = false;
        var storageKey = 'pc-barcode-lookup-sources';
        var panel = document.createElement('div'); panel.className = 'bs-lookup'; panel.dataset.role = 'lookup';
        root.querySelector('[data-role="reading"]').appendChild(panel);
        var modes = document.createElement('div'); modes.className = 'seg'; modes.setAttribute('role','group'); modes.setAttribute('aria-label','Scanner mode');
        modes.innerHTML = '<button type="button" data-view="decode">Decode</button><button type="button" data-view="lookup">Lookup</button>';
        root.querySelector('.bs-layout').prepend(modes);
        var layoutLabel = root.querySelector('.bs-layout .form-label'); layoutLabel.classList.add('bs-sr-only');
        function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
        function all() { return L.defaults.concat(users); }
        function selected() { return all().find(function (s) { return s.id === source; }); }
        function identity() { return L.identify(opts.capture(), opts.engine); }
        function load() { try { var raw = localStorage.getItem(storageKey); users = raw ? L.file(JSON.parse(raw)) : []; loadError = ''; } catch (e) { users = []; loadError = 'Saved sources could not be read: ' + e.message; } }
        function invalidate() { revision++; if (controller) { controller.abort(); controller = null; } clearTimeout(deadline); outcome = null; }
        function state() { var p = new URLSearchParams(); if (view !== 'decode') { p.set('view',view); } if (source) { p.set('source',source); } if (edit) { p.set('edit',edit); } return p.toString(); }
        function navigate(next, nextEdit) { invalidate(); opts.stop(); view = next; edit = nextEdit || ''; render(); root.querySelector('[data-role=reading]').scrollTop = 0; opts.changed(); }
        function setState(s) { invalidate(); var p = new URLSearchParams(s); view = ['lookup','sources'].includes(p.get('view')) ? p.get('view') : 'decode'; source = p.get('source') || ''; edit = p.get('edit') || ''; load(); render(); }
        function notice(s, bad) { return '<p class="notice ' + (bad ? 'danger' : '') + '">' + esc(s) + '</p>'; }
        function render() {
            if (destroyed) { return; }
            modes.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed',String(b.dataset.view === view)); });
            root.querySelector('[data-role="results"]').hidden = view !== 'decode'; panel.hidden = view === 'decode';
            root.querySelector('[data-role="layout"]').hidden = view !== 'decode';
            root.classList.toggle('bs-lookup-mode', view !== 'decode');
            if (view === 'decode') { return; }
            if (view === 'sources') { renderSources(); return; }
            var id = identity(), options = all().filter(function (s) { return L.eligible(s,id); });
            if (!source && options.length === 1) { source = options[0].id; }
            var s = selected(), compatible = s && L.eligible(s,id);
            var html = '<div class="bs-result-head"><span class="chip">' + esc(id.kind === 'uri' ? 'URL' : 'Product lookup') + '</span>' +
                (opts.capture() ? '<h2 class="bs-value">' + esc(opts.capture().text) + '</h2>' : '') + '</div>';
                    if (compatible && outcome) {
                        if (outcome.message) { html += notice(outcome.message,!!outcome.error); }
                        else if (!outcome.found) { html += notice('Not found in '+s.name+'. The barcode may still be valid.',false); }
                        else { html += '<h3>'+esc(outcome.title)+'</h3><table class="kv-table bs-fields"><tbody>'+outcome.fields.map(function (f) { return '<tr><th scope="row">'+esc(f.label)+'</th><td>'+esc(f.value)+'</td></tr>'; }).join('')+'</tbody></table>'; }
                        if (outcome.fetched) { html += '<p class="form-help">Retrieved '+esc(new Date(outcome.fetched).toLocaleString())+'.</p>'; }
                    }
            if (loadError) { html += notice(loadError,true); }
            if (!id.kind) { html += notice(id.reason,false); }
            else {
                html += '<label class="form-label" for="' + root.dataset.lookupId + '">Source</label><select class="form-select" id="' + root.dataset.lookupId + '" data-lookup="source"><option value="">Choose a source</option>' + options.map(function (s) { return '<option value="'+esc(s.id)+'"'+(s.id === source ? ' selected' : '')+'>'+esc(s.name)+'</option>'; }).join('') + '</select>';
                if (source && !compatible) { html += notice('The selected source is unavailable for this barcode. Choose a compatible source.',false); }
                if (!options.length) { html += notice('No source accepts this identifier.',false); }
                if (id.note) { html += '<p class="form-help">'+esc(id.note)+'</p>'; }
                if (compatible) {
                    html += '<p class="form-help">'+esc(s.description)+'</p>';
                    if (s.execution === 'local') {
                        html += '<p>Destination: <strong>'+esc(new URL(id.value).host)+'</strong></p><p><a href="'+esc(L.safeUrl(id.value))+'" target="_blank" rel="noopener noreferrer">Open URL</a></p>';
                    } else {
                        try {
                            var url = L.request(s,id), target = s.request.transport === 'connector' ? 'Open Food Facts through Parks Computing' : new URL(url).host;
                            html += '<p class="form-help">Send <code>'+esc(id.value)+'</code> to '+esc(target)+'.</p><button type="button" class="btn" data-lookup="run"'+(controller ? ' disabled' : '')+'>Look up</button>';
                        } catch (e) { html += notice(e.message,true); }
                    }
                    if (s.attribution) { html += '<p class="form-help"><a href="'+esc(s.attribution.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.attribution.name)+'</a>. '+esc(s.attribution.text)+'</p>'; }
                }
            }
            html += '<p><button type="button" class="btn" data-lookup="manage">Manage sources</button></p>';
            panel.innerHTML = html;
        }
        function renderSources() {
            var s = selected() || L.defaults[0], editing = edit === s.id && s.id.startsWith('user:');
            panel.innerHTML = '<h2>Lookup sources</h2><p class="form-help">Copy a default to customize it. Definitions are JSON. <a href="/page/barcode-lookup-guide" target="_blank" rel="noopener">Read the source-format guide</a> for fields and an example.</p>'+ (loadError ? notice(loadError,true) : '') +
                '<label class="form-label" for="'+root.dataset.lookupId+'">Source definition</label><select class="form-select" id="'+root.dataset.lookupId+'" data-lookup="definition">'+all().map(function (x) { return '<option value="'+esc(x.id)+'"'+(x.id === s.id ? ' selected' : '')+'>'+esc(x.name)+'</option>'; }).join('')+'</select>'+
                '<div class="bs-source-actions"><button class="btn" type="button" data-lookup="clone">Copy as new source</button><button class="btn" type="button" data-lookup="export">Export</button>'+(s.id.startsWith('user:') ? '<button class="btn" type="button" data-lookup="edit">Edit</button><button class="btn btn-danger" type="button" data-lookup="delete">Delete</button>' : '')+'</div>'+
                '<label class="form-label" for="'+root.dataset.lookupId+'-json">'+(editing ? 'Edit source JSON' : 'Source JSON')+'</label><textarea class="form-input" id="'+root.dataset.lookupId+'-json" data-lookup="json" rows="12" spellcheck="false"'+(editing?'':' readonly')+'>'+esc(JSON.stringify(s,null,2))+'</textarea>'+
                (editing ? '<button class="btn" type="button" data-lookup="save">Save source</button>' : '')+
                '<p class="form-help">Imports use a version 1 pc-barcode-lookup-sources file. Duplicate IDs are rejected; edit an existing source to replace it.</p><label class="form-label">Import source file<input class="form-input" type="file" accept=".json,application/json" data-lookup="import"></label><p data-lookup="feedback" role="status"></p><button class="btn" type="button" data-lookup="back">Back to lookup</button>';
        }
        function persist(next) { var data = {format:'pc-barcode-lookup-sources',version:1,sources:next}; L.file(data); localStorage.setItem(storageKey,JSON.stringify(data)); users=next; loadError=''; window.dispatchEvent(new CustomEvent('pc:lookup-sources')); }
        function feedback(e) { var p = panel.querySelector('[data-lookup="feedback"]'); if (p) { p.className='notice danger'; p.textContent=e.message; } }
        async function run() {
            if (controller) { return; }
            var s=selected(), id=identity(); if (!s || !L.eligible(s,id)) { return; }
            var key=s.request.transport === 'connector' ? 'open-food-facts' : s.request.origin;
            if ((cooldowns.get(key)||0)>Date.now()) { outcome={error:true,message:'Please wait '+Math.ceil((cooldowns.get(key)-Date.now())/1000)+' seconds before retrying.'};render();return; }
            invalidate(); var token=revision, abort=new AbortController(), timedOut=false; controller=abort;
            outcome={message:'Looking up...'};render();deadline=setTimeout(function(){timedOut=true;abort.abort();},15000);
            try { var result=await L.execute(s,id,abort.signal); if (!destroyed && token===revision) { outcome=Object.assign(result,{fetched:Date.now()}); } }
            catch(e) { if (!destroyed && token===revision) { if(e.retrySeconds){cooldowns.set(key,Date.now()+e.retrySeconds*1000);} outcome={error:true,message:timedOut?'Lookup timed out. Try again.':e instanceof TypeError?'The source could not be reached or does not permit browser access.':e.message}; } }
            finally { if (!destroyed && token===revision) { clearTimeout(deadline);controller=null;render();root.querySelector('[data-role=reading]').scrollTop=0; } }
        }
        async function click(e) {
            var b=e.target.closest('[data-lookup]');if(!b||b.tagName!=='BUTTON'){return;}
            var s=selected()||L.defaults[0];
            try { switch(b.dataset.lookup){
                case 'run':run();break;
                case 'manage':source=s.id;navigate('sources');break;
                case 'back':navigate('lookup');break;
                case 'clone':var copy=JSON.parse(JSON.stringify(s));copy.id='user:'+crypto.randomUUID();copy.name=s.name+' copy';copy.copiedFrom={id:s.id,revision:s.revision||1};persist(users.concat([copy]));source=copy.id;navigate('sources',copy.id);break;
                case 'edit':source=s.id;navigate('sources',s.id);break;
                case 'save':var updated=JSON.parse(panel.querySelector('[data-lookup="json"]').value);L.validate(updated,true);if(updated.id!==edit){throw new Error('Keep this source ID. Use Copy as new source for a new ID.');}persist(users.map(function(x){return x.id===edit?updated:x;}));navigate('sources');break;
                case 'delete':if(confirm('Delete '+s.name+' from this browser?')){persist(users.filter(function(x){return x.id!==s.id;}));source='';navigate('sources');}break;
                case 'export':var exported=JSON.parse(JSON.stringify(s));if(exported.id.startsWith('builtin:')){exported.copiedFrom={id:s.id,revision:s.revision||1};exported.id='user:'+s.id.slice(8);}var blob=new Blob([JSON.stringify({format:'pc-barcode-lookup-sources',version:1,sources:[exported]},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='barcode-lookup-sources.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);break;
            }}catch(err){feedback(err);}
        }
        async function change(e){try{switch(e.target.dataset.lookup){
            case 'source':invalidate();source=e.target.value;render();opts.changed();break;
            case 'definition':source=e.target.value;navigate('sources');break;
            case 'import':var f=e.target.files[0];if(!f){return;}if(f.size>128*1024){throw new Error('Source files must be smaller than 128 KiB.');}var added=L.file(JSON.parse(await f.text()));if(destroyed){return;}load();if(added.some(function(s){return users.some(function(u){return s.id===u.id;});})){throw new Error('An imported ID already exists. No sources were changed.');}persist(users.concat(added));navigate('sources');break;
        }}catch(err){feedback(err);}}
        function modeClick(e){var b=e.target.closest('[data-view]');if(b){navigate(b.dataset.view);}}
        function storage(e){if(e.type==='storage'&&e.key!==storageKey){return;}invalidate();load();render();}
        root.dataset.lookupId='lookup-'+crypto.randomUUID();load();panel.addEventListener('click',click);panel.addEventListener('change',change);modes.addEventListener('click',modeClick);window.addEventListener('storage',storage);window.addEventListener('pc:lookup-sources',storage);
        return {render:render,state:state,setState:setState,invalidate:invalidate,manage:function(){navigate('sources');},destroy:function(){destroyed=true;invalidate();window.removeEventListener('storage',storage);window.removeEventListener('pc:lookup-sources',storage);panel.removeEventListener('click',click);panel.removeEventListener('change',change);modes.removeEventListener('click',modeClick);}};
    };
})();
