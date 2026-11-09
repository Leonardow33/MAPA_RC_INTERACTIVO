// Cifra el token de GitHub del panel KAM (flyer rush de bonus_at.html) con la contraseña de la KAM.
// Uso:  TOKEN=github_pat_... CLAVE=xxxx node scripts/cifrar_token_rush.js
// Imprime el objeto que va en RUSH_TOKEN_ENC dentro de BONOS PARTNERS/bonus_at.html.
// AES-GCM 256 con clave derivada por PBKDF2-SHA256 (600 000 iteraciones). Nunca guardes el token en claro.
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
const getRandomValues = a => webcrypto.getRandomValues(a);

(async () => {
  const { TOKEN, CLAVE } = process.env;
  if (!TOKEN || !CLAVE) { console.error('Faltan TOKEN y/o CLAVE'); process.exit(1); }
  const enc  = new TextEncoder();
  const salt = getRandomValues(new Uint8Array(16));
  const iv   = getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey('raw', enc.encode(CLAVE), 'PBKDF2', false, ['deriveKey']);
  const key  = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
                                      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct   = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(TOKEN)));
  const b64  = a => Buffer.from(a).toString('base64');
  console.log(JSON.stringify({ s: b64(salt), i: b64(iv), c: b64(ct) }));
})();
