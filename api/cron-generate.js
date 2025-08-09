import { runAutomatedWorkflow } from './automated-daily-workflow.js';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!authHeader || authHeader !== expected) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const edition = await runAutomatedWorkflow();
    res.json({
      success: true,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        date: edition.edition_date,
        status: edition.status
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
