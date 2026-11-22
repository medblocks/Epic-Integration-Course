import jose from 'node-jose'
import fs from 'fs'

// Builds keys.json from an existing PEM private key (README step 1)
// Usage: node scripts/2b_keys_from_pem.js [path/to/privatekey.pem]
const pemPath = process.argv[2] ?? new URL('../privatekey.pem', import.meta.url)
const outPath = new URL('keys.json', import.meta.url)

const keyStore = jose.JWK.createKeyStore()
const key = await keyStore.add(fs.readFileSync(pemPath), 'pem', { alg: 'RS384', use: 'sig' })

fs.writeFileSync(outPath, JSON.stringify(keyStore.toJSON(true), null, '  '))
console.log(`keys.json written. kid: ${key.kid}`)
