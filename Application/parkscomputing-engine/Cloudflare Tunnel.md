# Cloudflare Tunnel
Here's the complete setup guide based on the official Cloudflare documentation:

## Prerequisites

1. **Cloudflare account** (free tier is sufficient)
2. **Domain added to Cloudflare** (parkscomputing.com)
3. **DNS managed by Cloudflare** (nameservers pointing to Cloudflare)
4. **Container running locally** on port 8080

## Step 1: Add Domain to Cloudflare (If Not Already Done)

**If your domain isn't on Cloudflare yet:**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click "Add a Site"
3. Enter `parkscomputing.com`
4. Choose Free plan
5. Cloudflare will scan your DNS records
6. Update nameservers at your domain registrar to Cloudflare's nameservers
7. Wait for DNS propagation (up to 24 hours)

## Step 2: Install cloudflared

**On Ubuntu/Debian:**
```bash
# Download and install the latest release
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Verify installation
cloudflared --version
```

**Alternative installation methods:**
```bash
# Via apt repository (recommended for automatic updates)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared
```

## Step 3: Authenticate cloudflared

**Login to your Cloudflare account:**
```bash
cloudflared tunnel login
```

This will:
- Open a browser window
- Ask you to log into Cloudflare
- Choose the domain (parkscomputing.com)
- Download a certificate to `~/.cloudflared/cert.pem`

**Verify authentication:**
```bash
ls -la ~/.cloudflared/
# Should show cert.pem file
```

## Step 4: Create a Tunnel

**Create a named tunnel:**
```bash
cloudflared tunnel create parkscomputing
```

This creates:
- A tunnel with UUID (save this!)
- Credentials file: `~/.cloudflared/[UUID].json`
- Tunnel registration in your Cloudflare account

**Note the tunnel UUID from the output:**
```
Created tunnel parkscomputing with id 12345678-1234-1234-1234-123456789abc
```

**Verify tunnel creation:**
```bash
cloudflared tunnel list
```

## Step 5: Create Configuration File

**Create `~/.cloudflared/config.yml`:**
```yaml
tunnel: 12345678-1234-1234-1234-123456789abc  # Your tunnel UUID
credentials-file: /home/yourusername/.cloudflared/12345678-1234-1234-1234-123456789abc.json

ingress:
  # Route parkscomputing.com to your local container
  - hostname: parkscomputing.com
    service: http://localhost:8080

  # Route www.parkscomputing.com to your local container
  - hostname: www.parkscomputing.com
    service: http://localhost:8080

  # Catch-all rule (required)
  - service: http_status:404
```

**Advanced configuration with multiple sites:**
```yaml
tunnel: 12345678-1234-1234-1234-123456789abc
credentials-file: /home/yourusername/.cloudflared/12345678-1234-1234-1234-123456789abc.json

ingress:
  # Main site
  - hostname: parkscomputing.com
    service: http://localhost:8080
  - hostname: www.parkscomputing.com
    service: http://localhost:8080

  # Future: Wife's site (when ready)
  - hostname: padmajairam.com
    service: http://localhost:8081
  - hostname: www.padmajairam.com
    service: http://localhost:8081

  # Admin interface (optional)
  - hostname: admin.parkscomputing.com
    service: http://localhost:9000

  # Catch-all
  - service: http_status:404
```

## Step 6: Route DNS Traffic

**Create DNS records pointing to your tunnel:**
```bash
# Route parkscomputing.com through the tunnel
cloudflared tunnel route dns parkscomputing parkscomputing.com

# Route www subdomain through the tunnel
cloudflared tunnel route dns parkscomputing www.parkscomputing.com
```

**Verify DNS routes:**
```bash
cloudflared tunnel route dns list
```

## Step 7: Start Your Container

**Make sure your container is running and accessible locally:**
```bash
# Test your container locally first
docker run -d \
  --name parkscomputing \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e ASPNETCORE_URLS=http://+:8080 \
  your-container-image

# Verify it's responding
curl -I http://localhost:8080
# Should return HTTP 200
```

## Step 8: Run the Tunnel

**Start the tunnel:**
```bash
cloudflared tunnel run parkscomputing
```

**For production, run as a service:**
```bash
# Install as a system service
sudo cloudflared service install

# Enable and start the service
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Check service status
sudo systemctl status cloudflared
```

## Step 9: Verify Everything Works

**Test public access:**
```bash
# Test from another machine or use online tools
curl -I https://parkscomputing.com
curl -I https://www.parkscomputing.com

# Should return HTTP 200 with valid SSL certificate
```

**Check tunnel status:**
```bash
cloudflared tunnel info parkscomputing
```

**View tunnel logs:**
```bash
# If running as service
sudo journalctl -u cloudflared -f

# If running manually
# Logs appear in terminal where you ran cloudflared tunnel run
```

## Step 10: Configure Service Management (Production)

**Create systemd service file** (if not using `cloudflared service install`):
```bash
sudo tee /etc/systemd/system/cloudflared.service > /dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=cloudflared
ExecStart=/usr/local/bin/cloudflared tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
```

**Create cloudflared user:**
```bash
sudo useradd -r -s /bin/false cloudflared
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/config.yml /etc/cloudflared/
sudo cp ~/.cloudflared/*.json /etc/cloudflared/
sudo chown -R cloudflared:cloudflared /etc/cloudflared
```

**Update config file path:**
```yaml
# /etc/cloudflared/config.yml
tunnel: 12345678-1234-1234-1234-123456789abc
credentials-file: /etc/cloudflared/12345678-1234-1234-1234-123456789abc.json

ingress:
  - hostname: parkscomputing.com
    service: http://localhost:8080
  - hostname: www.parkscomputing.com
    service: http://localhost:8080
  - service: http_status:404
```

**Start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

## Troubleshooting Common Issues

**1. Tunnel not connecting:**
```bash
# Check if port 8080 is accessible
curl -I http://localhost:8080

# Check cloudflared logs
cloudflared tunnel run parkscomputing --loglevel debug
```

**2. DNS not resolving:**
```bash
# Check DNS propagation
nslookup parkscomputing.com
dig parkscomputing.com

# Verify Cloudflare DNS settings in dashboard
```

**3. SSL certificate issues:**
- Cloudflare automatically provisions SSL certificates
- Wait 5-10 minutes for certificate issuance
- Ensure DNS is properly routed through Cloudflare

**4. Container not accessible:**
```bash
# Ensure container binds to correct interface
docker run -p 127.0.0.1:8080:8080 your-image  # Correct
# NOT: docker run -p 8080:8080 your-image     # Wrong - binds to all interfaces
```

## Cloudflare Dashboard Configuration

**In the Cloudflare dashboard:**
1. Go to **Zero Trust** > **Networks** > **Tunnels**
2. You should see your tunnel listed as "Healthy"
3. Click on the tunnel to see traffic statistics
4. Configure additional security rules if needed

## Security Best Practices

**Tunnel security:**
- Tunnels use TLS encryption
- No inbound firewall rules needed
- Cloudflare provides DDoS protection
- Access logs available in dashboard

**Additional security (optional):**
```yaml
# Add access policies to config.yml
ingress:
  - hostname: admin.parkscomputing.com
    service: http://localhost:9000
    originRequest:
      # Require Cloudflare Access authentication
      access:
        required: true
        teamName: your-team-name
```

## Performance Optimization

**Enable Argo Smart Routing** (paid feature):
- Reduces latency by up to 35%
- $5/month + $0.10/GB
- Optional for personal sites

**Free performance features:**
- HTTP/2 and HTTP/3 (enabled by default)
- Brotli compression
- Global CDN caching
- Image optimization (Polish - Pro plan)

## Monitoring and Logs

**View tunnel metrics:**
```bash
# Real-time tunnel statistics
cloudflared tunnel info parkscomputing --json

# Connection status
cloudflared tunnel list
```

**Cloudflare Analytics:**
- Available in dashboard under Analytics
- Shows traffic, performance, security events
- Free tier includes basic analytics

Your tunnel is now ready! The key advantages over Tailscale Funnel beta:
- ✅ Production-ready (GA since 2021)
- ✅ Enterprise-grade reliability
- ✅ Global CDN performance
- ✅ Built-in DDoS protection
- ✅ Comprehensive logging and analytics
- ✅ Free tier with generous limits

Would you like me to help you troubleshoot any specific step or move on to setting up the database migration next?
