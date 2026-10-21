import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zero-dependency .env loader
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

export const PORT = process.env.PORT || 3030;
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
export const VOTING_SECRET = process.env.VOTING_SECRET || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
export const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini'; // 'gemini' or 'groq'
export const isProduction = process.env.NODE_ENV === 'production';
export const ROOT_DIR = __dirname;
export const PUBLIC_DIR = path.join(__dirname, 'public');
export const BACKUP_DIR = path.join(__dirname, 'backups');
export const DB_PATH = path.join(__dirname, 'frontier.db');
