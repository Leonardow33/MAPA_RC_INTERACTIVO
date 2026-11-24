// Crea data/socios_tinbet.json (portal de socios de BONOS PARTNERS/bonus_tinbet.html) con el acceso de administrador.
// Uso:  TOKEN=github_pat_... CLAVE=xxxx node scripts/init_socios_tinbet.js        (FORZAR=1 para reemplazar uno existente)
// TOKEN: token fine-grained solo de este repo con Contents: Read and write (el panel admin publica el JSON con él).
// CLAVE: contraseña del usuario "admin" del portal. Se genera una clave del portal (K) al azar.
// El admin guarda {gh: TOKEN, k: K} cifrado con su contraseña (PBKDF2-SHA256 600k + AES-GCM). Nunca guardes el token en claro.
// OJO: con FORZAR=1 se crea una K nueva y todos los socios existentes dejan de poder entrar (hay que darles contraseña nueva).
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;

const FILE = path.join(__dirname, '..', 'data', 'socios_tinbet.json');
const b64 = a => Buffer.from(a).toString('base64');

(async () => {
  const { TOKEN, CLAVE, FORZAR } = process.env;
  if (!TOKEN || !CLAVE) { console.error('Faltan TOKEN y/o CLAVE'); process.exit(1); }
  if (CLAVE.length < 10) { console.error('La CLAVE debe tener al menos 10 caracteres'); process.exit(1); }
  if (fs.existsSync(FILE) && FORZAR !== '1') { console.error('Ya existe ' + FILE + ' (usa FORZAR=1 para reemplazarlo)'); process.exit(1); }
  const enc = new TextEncoder();
  const k = b64(webcrypto.getRandomValues(new Uint8Array(32)));
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey('raw', enc.encode(CLAVE), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
                                     base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ gh: TOKEN, k }))));
  const cfg = {
    partner: 'TINBET',
    esquema_default: 'base',
    esquemas: { base: { tramos: [{ hasta: 1500, pct: 8 }, { hasta: 6000, pct: 10 }, { hasta: 20000, pct: 12 }, { hasta: null, pct: 14 }], raspas: 8, premios: 2, igv: 18 } },
    admin: { s: b64(salt), i: b64(iv), c: b64(ct) },
    dataRepo: null,
    dataToken: null,
    incentivos: [],
    socios: [],
    updated: new Date().toISOString()
  };
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 1) + '\n');
  console.log('OK: ' + FILE);
})();
