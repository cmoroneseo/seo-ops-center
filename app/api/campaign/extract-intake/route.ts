import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are an SEO strategist intake processor. You receive a client questionnaire or intake document and extract structured data for building an SEO campaign plan.

Extract the following from the document. If a field cannot be determined, omit it. Return valid JSON only — no markdown, no commentary.

{
  "intake": {
    "businessName": "string",
    "businessDescription": "string (1-2 sentences)",
    "targetServices": ["string"],
    "targetLocations": ["string"],
    "primaryConversionEvents": ["string"],
    "analyticsConfidence": "none | partial | strong",
    "knownCompetitors": ["string"],
    "constraints": ["string — budget, dev access, compliance, etc."],
    "riskNotes": ["string"]
  },
  "goals": [
    {
      "title": "string",
      "category": "leads | sales | local_visibility | authority | traffic | content_moat | launch_support | reputation | other",
      "description": "string (1 sentence)"
    }
  ],
  "kpis": [
    {
      "metricName": "string",
      "kpiGroup": "visibility | traffic | conversion | authority | content | technical",
      "source": "gsc | ga4 | gbp | ahrefs | manual | internal",
      "baselineValue": number or null,
      "targetValue": number or null,
      "confidence": "low | medium | high"
    }
  ],
  "workstreams": [
    {
      "name": "string",
      "category": "research_strategy | technical_seo | on_page | content | authority | local_seo | analytics | cro",
      "rationale": "string (why this workstream matters for this client)"
    }
  ],
  "phases": [
    {
      "name": "string",
      "phaseOrder": number,
      "objective": "string"
    }
  ],
  "expectations": [
    {
      "type": "ranking | traffic | conversion | content | technical | authority | local",
      "statement": "string",
      "targetWindowDays": number,
      "confidence": "low | medium | high"
    }
  ],
  "strategyModel": "authority_relevance_trust | custom | local | ecommerce | saas | other"
}

Guidelines:
- Extract real data from the document, don't fabricate metrics or targets.
- If the client says "no idea" or leaves a field blank, set confidence to "low" and omit baseline values.
- Infer workstreams from what the client needs (e.g., multi-location = local_seo workstream).
- Create realistic phases based on the client's situation (2-year startup vs. enterprise).
- Keep expectations conservative and measurable — never guarantee outcomes.
- If the client mentions specific revenue targets, include them as KPIs with source "manual".
- Derive the strategyModel from the overall picture (local-heavy = "local", content-focused = "authority_relevance_trust", etc.).`;

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Import the inner lib directly — the main entry point tries to load a test
  // PDF at import time which fails in serverless (ENOENT).
  // @ts-expect-error pdf-parse v1 has no type declarations
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (mod as any).default ?? mod;
  const result = await pdfParse(buffer);
  return result.text;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    let text: string;

    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const pastedText = formData.get('text') as string | null;

      if (file && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) {
        const buffer = Buffer.from(await file.arrayBuffer());
        text = await extractPdfText(buffer);
      } else if (file) {
        text = await file.text();
      } else if (pastedText) {
        text = pastedText;
      } else {
        return NextResponse.json({ error: 'No file or text provided' }, { status: 400 });
      }
    } else {
      const body = await req.json();
      text = body.text ?? '';
    }

    if (!text || text.trim().length < 50) {
      return NextResponse.json({ error: 'Questionnaire text is too short or missing' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract the campaign plan data from this client questionnaire:\n\n${text.slice(0, 15000)}`,
        },
      ],
    });

    const responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('extract-intake error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
