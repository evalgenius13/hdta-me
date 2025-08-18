// api/cron/automated-daily-workflow.js

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 26;      // total
    this.numAnalyzed = 6;       // first N get AI analysis
    this.maxRetries = 3;
    this.retryDelay = 1500;
    this.startTime = Date.now();
  }

  async runFullWorkflow() {
    console.log("🚀 Starting daily workflow...");
    const edition = await this.curateAndAnalyze();
    await this.publishToWebsite(edition.id);
    await this.markNewsletterSent(edition.id);
    console.log("✅ Daily workflow completed");
    return edition;
  }

  async curateAndAnalyze() {
    const today = new Date().toISOString().split("T")[0];
    const existing = await this.findEdition(today);
    if (existing) {
      console.log(`📰 Edition already exists for ${today}, returning existing`);
      return existing;
    }

    // Fetch curated news
    const articles = await this.fetchNews();
    if (!articles.length) throw new Error("No news articles returned.");

    // Save new edition row
    const { data: edition, error } = await supabase
      .from("editions")
      .insert({ date: today })
      .select()
      .single();

    if (error) throw error;

    // Analyze top N
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      let preGeneratedAnalysis = null;

      if (i < this.numAnalyzed) {
        preGeneratedAnalysis = await this.retryWithBackoff(() =>
          this.analyzeArticle(article)
        );
      }

      await supabase.from("articles").insert({
        edition_id: edition.id,
        title: article.title,
        url: article.url,
        source: article.source?.name || "Unknown",
        snippet: article.description || "",
        preGeneratedAnalysis
      });
    }

    return edition;
  }

  async fetchNews() {
    console.log("📡 Fetching news...");
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", "policy OR regulation OR government");
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", this.maxArticles);
    url.searchParams.set("from", new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()); // last 36h

    const resp = await fetch(url, {
      headers: { "X-Api-Key": process.env.NEWS_API_KEY }
    });
    const data = await resp.json();

    if (!data.articles) {
      console.error("❌ Failed to fetch articles:", data);
      return [];
    }
    return data.articles;
  }

  async analyzeArticle(article) {
    console.log(`🤖 Analyzing: ${article.title}`);
    const prompt = `
Analyze the following news article. Write in two H3 sections only.

### What's Happening Here?
Explain the concrete facts (costs, payback, access, timelines, paperwork).

### How Does This Affect Me?
Explain ripple effects and reveal what's not said (hidden motives, delays, politics).
Keep tone plain English, balanced, with grit only in open/close.
Article:
"${article.title}" - ${article.description || ""}`;

    const resp = await client.chat.completions.create({
      model: "gpt-5", // primary
      // fallback list if rate-limited
      // model: ["gpt-5","gpt-4o","gpt-4.1"],
      messages: [
        { role: "system", content: "You are a policy explainer." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    });

    const raw = resp.choices[0]?.message?.content?.trim() || "";
    return this.splitSections(raw);
  }

  splitSections(text) {
    const normalized = text.trim();

    // Allowed headers strictly
    const allowed = [
      /^### What's Happening Here\?/mi,
      /^### How Does This Affect Me\?/mi
    ];

    const headers = normalized.match(/^### .+/gmi) || [];
    if (headers.length && !headers.every(h => allowed.some(r => r.test(h)))) {
      return null; // reject if stray headers
    }

    // Split on H3 headers first
    const parts = normalized.split(/^### /m);
    const sections = {};
    for (const part of parts) {
      if (part.startsWith("What's Happening Here?")) {
        sections.whats_happening = part.replace("What's Happening Here?", "").trim();
      } else if (part.startsWith("How Does This Affect Me?")) {
        sections.affects_me = part.replace("How Does This Affect Me?", "").trim();
      }
    }

    // Fallback: check ALL CAPS style
    if (!sections.whats_happening && /WHAT'S HAPPENING HERE/i.test(normalized)) {
      const [, rest] = normalized.split(/WHAT'S HAPPENING HERE/i);
      sections.whats_happening = rest.split(/HOW DOES THIS AFFECT ME/i)[0]?.trim();
    }
    if (!sections.affects_me && /HOW DOES THIS AFFECT ME/i.test(normalized)) {
      const [, after] = normalized.split(/HOW DOES THIS AFFECT ME/i);
      sections.affects_me = after.trim();
    }

    return Object.keys(sections).length ? sections : null;
  }

  async publishToWebsite(editionId) {
    console.log(`🌐 Publishing edition ${editionId} to website...`);
    // stub — connect to frontend later
  }

  async markNewsletterSent(editionId) {
    console.log(`📧 Marking newsletter sent for edition ${editionId}...`);
    await supabase.from("editions").update({ newsletter_sent: true }).eq("id", editionId);
  }

  async findEdition(date) {
    const { data } = await supabase.from("editions").select("*").eq("date", date).maybeSingle();
    return data;
  }

  async retryWithBackoff(fn) {
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        return await fn();
      } catch (err) {
        attempt++;
        console.warn(`Retry ${attempt}/${this.maxRetries}:`, err.message);
        if (attempt >= this.maxRetries) throw err;
        await new Promise(r => setTimeout(r, this.retryDelay * attempt));
      }
    }
  }
}

export default async function handler(req, res) {
  try {
    const publisher = new AutomatedPublisher();
    const edition = await publisher.runFullWorkflow();
    res.json({ success: true, edition });
  } catch (error) {
    console.error("❌ Workflow error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
