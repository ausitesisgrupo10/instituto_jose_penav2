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
let shutdownHooksRegistered = false;
let estadoConexionBD: { modo: 'atlas' | 'local-dev' | 'local-respaldo'; detalle?: string } = {
  modo: 'local-dev',
};

function registrarHooksCierre() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const cerrarRecursos = async () => {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      if (mongoMemoryServer) {
        await mongoMemoryServer.stop();
        mongoMemoryServer = null;
      }
    } catch {
      // Ignorar errores al cerrar
    }
  };

  process.once('SIGINT', () => {
    void cerrarRecursos().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void cerrarRecursos().finally(() => process.exit(0));
  });
}

export function obtenerEstadoBD() {
  return estadoConexionBD;
}

/**
 * Normaliza `MONGODB_URI` eliminando comillas o prefijos accidentales y codificando
 * caracteres especiales no escapados en usuario/contraseña.
 * Devuelve `null` si está vacía o contiene placeholders sin reemplazar (ej. `<db_password>`).
 */
function normalizarMongoUri(rawUri?: string): { uri: string | null; motivoDescarte?: string } {
  if (!rawUri) return { uri: null };

  let cleaned = rawUri.trim();
  if (!cleaned) return { uri: null };

  if (/^MONGODB_URI\s*=/i.test(cleaned)) {
    cleaned = cleaned.replace(/^MONGODB_URI\s*=\s*/i, '').trim();
  }

  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  if (!cleaned) return { uri: null };

  if (/<(?:db_)?password>|<username>|<user>|<cluster>|MY_MONGODB_URI/i.test(cleaned)) {
    return {
      uri: null,
      motivoDescarte: 'MONGODB_URI contiene un placeholder sin reemplazar (ej. <db_password>).',
    };
  }

  const schemeMatch = cleaned.match(/^(mongodb(?:\+srv)?:\/\/)(.+)$/i);
  if (!schemeMatch) {
    return {
      uri: null,
      motivoDescarte: 'MONGODB_URI no tiene un esquema válido (mongodb:// o mongodb+srv://).',
    };
  }

  const scheme = schemeMatch[1];
  const rest = schemeMatch[2];
  const atIdx = rest.lastIndexOf('@');

  if (atIdx > 0) {
    const creds = rest.slice(0, atIdx);
    const hostAndRest = rest.slice(atIdx + 1);
    const colonIdx = creds.indexOf(':');
    if (colonIdx > 0) {
      const rawUser = creds.slice(0, colonIdx);
      const rawPass = creds.slice(colonIdx + 1);
      const encodePart = (part: string) => {
        if (/%[0-9A-Fa-f]{2}/.test(part) && !/[@:/?#[\]\s]/.test(part)) {
          return part;
        }
        return encodeURIComponent(part);
      };
      cleaned = `${scheme}${encodePart(rawUser)}:${encodePart(rawPass)}@${hostAndRest}`;
    }
  }

  return { uri: cleaned };
}

async function iniciarMongoLocal(): Promise<string> {
  registrarHooksCierre();
  const dbPath = path.join(process.cwd(), '.data', 'mongodb');
  fs.mkdirSync(dbPath, { recursive: true });
  try {
    console.log('⚡ Inicializando MongoDB local persistente en .data/mongodb...');
    mongoMemoryServer = await MongoMemoryServer.create({
      instance: {
        dbPath,
        storageEngine: 'wiredTiger',
      },
    });
    return mongoMemoryServer.getUri();
  } catch (persistErr) {
    console.warn('⚠️ No se pudo abrir dbPath persistente, usando instancia en memoria:', persistErr);
    mongoMemoryServer = await MongoMemoryServer.create();
    return mongoMemoryServer.getUri();
  }
}

/**
 * @función conectarBD
 * @descripción Conecta a MongoDB Atlas si existe `process.env.MONGODB_URI` o utiliza MongoDB local/en memoria como respaldo de desarrollo.
 * Siembra los datos iniciales únicamente cuando la colección de usuarios está vacía (`countDocuments() === 0`).
 * @returns {Promise<void>}
 */
export async function conectarBD(): Promise<void> {
  const { uri: envUri, motivoDescarte } = normalizarMongoUri(process.env.MONGODB_URI);

  if (motivoDescarte) {
    console.warn(`⚠️ ${motivoDescarte} Se usará la base local/en memoria como respaldo.`);
  }

  let conectadoAExternal = false;

  if (envUri && mongoose.connection.readyState === 0) {
    try {
      console.log('🌐 MONGODB_URI detectada. Conectando directamente a MongoDB externo (Atlas)...');
      const opciones: mongoose.ConnectOptions = {
        serverSelectionTimeoutMS: 15000,
      };
      if (envUri.includes('.mongodb.net') && !/[?&]authSource=/i.test(envUri)) {
        opciones.authSource = 'admin';
      }
      await mongoose.connect(envUri, opciones);
      conectadoAExternal = true;
      estadoConexionBD = { modo: 'atlas' };
      console.log('✅ Conexión con MongoDB Atlas / externo establecida exitosamente.');
    } catch (atlasError) {
      const mensaje = atlasError instanceof Error ? atlasError.message : String(atlasError);
      console.warn(
        `⚠️ No se pudo autenticar/conectar con MONGODB_URI (${mensaje}). Verifique usuario, contraseña o IP permitida en Atlas. Usando base local/en memoria como respaldo.`
      );
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
      estadoConexionBD = {
        modo: 'local-respaldo',
        detalle: mensaje,
      };
    }
  } else if (mongoose.connection.readyState !== 0 && envUri) {
    conectadoAExternal = true;
    estadoConexionBD = { modo: 'atlas' };
  }

  if (!conectadoAExternal && mongoose.connection.readyState === 0) {
    const localUri = await iniciarMongoLocal();
    await mongoose.connect(localUri, {
      serverSelectionTimeoutMS: 15000,
    });
    if (!envUri && !motivoDescarte) {
      estadoConexionBD = { modo: 'local-dev' };
    }
    console.log('✅ Conexión con MongoDB local/en memoria establecida exitosamente.');
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
}


