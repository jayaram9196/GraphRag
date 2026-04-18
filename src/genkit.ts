import 'dotenv/config';
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { neo4j } from './plugin';

export const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: 'bob-facts',
        embedder: googleAI.embedder('gemini-embedding-001'),
      },
    ]),
  ],
});
