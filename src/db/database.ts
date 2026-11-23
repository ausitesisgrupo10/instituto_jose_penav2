/**
 * @archivo src/db/database.ts
 * @descripción Configuración de conexión Mongoose a MongoDB y seeding inicial condicional para el Instituto José Peña.
 * @reglaDeNegocio Si `process.env.MONGODB_URI` está definida, se conecta directamente a esa URI (MongoDB Atlas) sin iniciar MongoDB local ni borrar datos.
 * Solo si `process.env.MONGODB_URI` no está definida, utiliza MongoDB local/en memoria como respaldo para desarrollo.
 * El seeding inicial se ejecuta únicamente cuando la colección de usuarios está vacía (`countDocuments() === 0`).
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../models/User.js';
import { sembrarDatasetCompleto } from './seedDataset.js';

let mongoMemoryServer: MongoMemoryServer | null = null;

/**
 * @función conectarBD
 * @descripción Conecta a MongoDB Atlas si existe `process.env.MONGODB_URI` o utiliza MongoDB local/en memoria como respaldo de desarrollo.
 * Siembra los datos iniciales únicamente cuando la colección de usuarios está vacía (`countDocuments() === 0`).
 * @returns {Promise<void>}
 */
export async function conectarBD(): Promise<void> {
  try {
    const envUri = process.env.MONGODB_URI?.trim();
    let uri = envUri;

    if (envUri) {
      console.log('🌐 MONGODB_URI detectada. Conectando directamente a MongoDB externo (Atlas)...');
    } else {
      const dbPath = path.join(process.cwd(), '.data', 'mongodb');
      fs.mkdirSync(dbPath, { recursive: true });
      try {
        console.log('⚡ MONGODB_URI no definida. Inicializando MongoDB local persistente en .data/mongodb...');
        mongoMemoryServer = await MongoMemoryServer.create({
          instance: {
            dbPath,
            storageEngine: 'wiredTiger',
          },
        });
        uri = mongoMemoryServer.getUri();
      } catch (persistErr) {
        console.warn('⚠️ No se pudo abrir dbPath persistente, usando instancia en memoria:', persistErr);
        mongoMemoryServer = await MongoMemoryServer.create();
        uri = mongoMemoryServer.getUri();
      }
    }

    if (mongoose.connection.readyState === 0 && uri) {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 15000,
      });
      console.log(
        envUri
          ? '✅ Conexión con MongoDB Atlas / externo establecida exitosamente.'
          : '✅ Conexión con MongoDB local/en memoria establecida exitosamente.'
      );
    }

    const conteoUsuarios = await User.countDocuments();
    if (conteoUsuarios === 0) {
      console.log('🌱 Colección de usuarios vacía (countDocuments === 0). Ejecutando seeding inicial...');
      await sembrarDatasetCompleto({ forzarLimpieza: false });
    } else {
      console.log(
        `ℹ️ Base de datos ya inicializada (${conteoUsuarios} usuarios). Se omite el seeding para preservar los datos existentes.`
      );
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error('❌ Error al conectar con MongoDB:', mensaje);
    throw error;
  }
}


