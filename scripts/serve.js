#!/usr/bin/env node
/* =========================================================================
 * PIXEL QUIZ ARENA - Petit serveur web local (optionnel, sans dépendance)
 *
 *   node scripts/serve.js [port]     (ou : npm start)
 *
 * Sert les fichiers du jeu et affiche l'adresse IP locale, pour jouer en
 * réseau local (les téléphones doivent être sur le même Wi-Fi).
 * Une connexion internet reste nécessaire pour la mise en relation PeerJS.
 * ========================================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html'; // /host -> host.html
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  🎮 PIXEL QUIZ ARENA est lancé !\n');
  console.log(`  Sur cet ordinateur : http://localhost:${PORT}/host`);
  ips.forEach((ip) => console.log(`  En réseau local    : http://${ip}:${PORT}/host   (téléphones : http://${ip}:${PORT}/play)`));
  console.log('\n  Ctrl+C pour arrêter.\n');
});
