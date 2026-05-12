import express, { Request, Response, NextFunction } from 'express';
import authRouter from './routes/auth.routes';
import farmsRouter from './routes/farms.routes';
import scansRouter from './routes/scans.routes';
import diseasesRouter from './routes/diseases.routes';
import syncRouter from './routes/sync.routes';
import remindersRouter from './routes/reminders.routes';

const app = express();

app.use(express.json());

app.use('/auth', authRouter);
app.use('/farms', farmsRouter);
app.use('/scans', scansRouter);
app.use('/diseases', diseasesRouter);
app.use('/sync', syncRouter);
app.use('/reminders', remindersRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.statusCode) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
