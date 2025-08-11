// scripts/create-daily-edition.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const today = new Date().toISOString().split('T')[0];

  // Check if today's edition already exists
  const { data: existing, error: checkErr } = await supabase
    .from('daily_editions')
    .select('*')
    .eq('edition_date', today)
    .single();

  if (checkErr && checkErr.code !== 'PGRST116') { // Not found is ok
    console.error('Error checking for today\'s edition:', checkErr);
    process.exit(1);
  }

  if (existing) {
    console.log('Edition for today already exists:', existing);
    return;
  }

  // Get the latest issue_number
  const { data: latest, error: latestErr } = await supabase
    .from('daily_editions')
    .select('issue_number')
    .order('issue_number', { ascending: false })
    .limit(1)
    .single();

  if (latestErr && latestErr.code !== 'PGRST116') {
    console.error('Error fetching latest edition:', latestErr);
    process.exit(1);
  }

  const nextIssue = latest ? (parseInt(latest.issue_number, 10) + 1) : 1;

  // Insert the new edition
  const { data: inserted, error: insertErr } = await supabase
    .from('daily_editions')
    .insert([
      {
        edition_date: today,
        issue_number: nextIssue,
        status: 'sent',
        featured_headline: null,
        editor_notes: null
      }
    ])
    .select()
    .single();

  if (insertErr) {
    console.error('Error inserting new edition:', insertErr);
    process.exit(1);
  }
  console.log('Created new daily edition:', inserted);
}

main();
