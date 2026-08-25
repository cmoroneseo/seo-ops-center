import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import TrainingHubClient from './TrainingHubClient';
import { parseTrainingGuideDocument } from '@/lib/training-guide';

export default async function TrainingPage() {
    const source = await readFile(join(process.cwd(), 'content/training/seo-playbook-2026-full.html'), 'utf8');
    return <TrainingHubClient guide={parseTrainingGuideDocument(source)} />;
}
