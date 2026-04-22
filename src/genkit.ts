import 'dotenv/config';
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { openAICompatible } from '@genkit-ai/compat-oai';
import { neo4j } from './plugin';

export const GENERATION_MODEL = 'groq/llama-3.3-70b-versatile';

export const ai = genkit({
  plugins: [
    googleAI(),
    openAICompatible({
      name: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    }),
    neo4j([
      {
        indexId: 'bob-facts',
        embedder: googleAI.embedder('gemini-embedding-001'),
      },
    ]),
  ],
});
