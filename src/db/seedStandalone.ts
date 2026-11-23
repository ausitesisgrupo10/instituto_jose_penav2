/**
 * @archivo src/db/seedStandalone.ts
 * @descripción Script ejecutable directamente via CLI / tsx para sembrar o restablecer
 * la base de datos con el Dataset del Instituto José Peña.
 * Uso: npx tsx src/db/seedStandalone.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { sembrarDatasetCompleto } from './seedDataset.js';

async function main() {
  console.log('🚀 Iniciando script de sembrado manual (Standalone)...');
  const envUri = process.env.MONGODB_URI?.trim();
  let uri = envUri;

  if (!uri) {
    console.log('⚡ MONGODB_URI no detectada. Levantando instancia local con MongoMemoryServer...');
    const mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }

  await mongoose.connect(uri);
  console.log(
    envUri
      ? '✅ Conectado a MongoDB Atlas / externo.'
      : '✅ Conectado a MongoDB local/en memoria.'
  );

  const forzarLimpieza = process.argv.includes('--force');
  await sembrarDatasetCompleto({ forzarLimpieza });

  console.log('🎉 Operación completada.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error en seeding standalone:', err instanceof Error ? err.message : err);
  process.exit(1);
});
