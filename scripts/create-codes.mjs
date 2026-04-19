import 'dotenv/config';
import { createAccessCodes, getDbMeta } from '../src/db.js';

const count = Number(process.argv[2] || 1);
const label = process.argv[3] || null;

const codes = createAccessCodes(count, label);

console.log(`Database: ${getDbMeta().dbPath}`);
console.log(codes.join('\n'));

