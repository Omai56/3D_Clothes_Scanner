// Minimal web server: serves the 3-page fit flow from public/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(root, '..', 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FitCheck running at http://localhost:${port}`));
