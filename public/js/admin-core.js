// admin-core.js - Core AdminPanel functionality - FIXED
class AdminPanel {
    constructor() {
        this.API_BASE = ''; // FIXED: Use relative URLs instead of hardcoded domain
        this.articles = [];
        this.settings = this.loadSettings();
        this.adminKey = 'hdta-admin-2025-temp'; // Change this in production
        this.currentFilter = 'all';
    }

    async init() {
        await this.loadData();
        this.updateStats();
    }

    async loadData() {
        try {
            const response = await fetch(`${this.API_BASE}/api/admin?action=get-articles`, {
                headers: {
                    'Authorization': `Bearer ${this.adminKey}`
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized - Check admin key');
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            this.articles = data.articles || [];
            
            if (data.edition) {
                const info = data.edition;
                const editionEl = document.getElementById('edition-info');
                if (editionEl) {
                    editionEl.textContent = `Issue #${info.issue_number} • ${info.date} (${info.status})`;
                }
            } else {
                const editionEl = document.getElementById('edition-info');
                if (editionEl) {
                    editionEl.textContent = 'No edition found for today';
                }
            }
            
            this.renderArticles();
            const loadingEl = document.getElementById('articles-loading');
            const gridEl = document.getElementById('articles-grid');
            if (loadingEl) loadingEl.style.display = 'none';
            if (gridEl) gridEl.style.display = 'grid';
            
            this.addLog('success', `Loaded ${this.articles.length} articles`);
            
        } catch (error) {
            console.error('Failed to load data:', error);
            this.addLog('error', 'Failed to load articles: ' + error.message);
            
            // Fallback to public API if admin fails
            if (error.message.includes('Unauthorized')) {
                this.addLog('warning', 'Falling back to public API...');
                await this.loadPublicData();
            }
        }
    }

    async loadPublicData() {
        try {
            const response = await fetch(`${this.API_BASE}/api/fetch-news`);
            const data = await response.json();
            
            this.articles = data.articles || [];
            
            if (data.edition_info) {
                const info = data.edition_info;
                const editionEl = document.getElementById('edition-info');
                if (editionEl) {
                    editionEl.textContent = `Issue #${info.issue_number} • ${info.date} (Public View)`;
                }
            }
            
            this.renderArticles();
            const loadingEl = document.getElementById('articles-loading');
            const gridEl = document.getElementById('articles-grid');
            if (loadingEl) loadingEl.style.display = 'none';
            if (gridEl) gridEl.style.display = 'grid';
            
        } catch (error) {
            console.error('Failed to load public data:', error);
            this.addLog('error', 'Failed to load public data: ' + error.message);
        }
    }

    loadSettings() {
        const defaults = {
            maxArticles: 6,
            daysBack: 3,
            minScore: 10,
            wordMin: 100,
            wordMax: 250,
            temperature: 0.4,
            similarity: 0.75,
            autoPublish: true
        };
        
        try {
            const saved = localStorage.getItem('hdta-admin-settings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch {
            return defaults;
        }
    }

    saveSettings() {
        const settings = {
            maxArticles: parseInt(document.getElementById('max-articles')?.value || '6'),
            daysBack: parseInt(document.getElementById('days-back')?.value || '3'),
            minScore: parseInt(document.getElementById('min-score')?.value || '10'),
            wordMin: parseInt(document.getElementById('word-min')?.value || '100'),
            wordMax: parseInt(document.getElementById('word-max')?.value || '250'),
            temperature: parseFloat(document.getElementById('temperature')?.value || '0.4'),
            similarity: parseFloat(document.getElementById('similarity')?.value || '0.75'),
            autoPublish: document.getElementById('auto-publish')?.checked || true
        };
        
        localStorage.setItem('hdta-admin-settings', JSON.stringify(settings));
        this.settings = settings;
        this.addLog('success', 'Settings saved successfully');
    }

    resetSettings() {
        localStorage.removeItem('hdta-admin-settings');
        this.settings = this.loadSettings();
        this.populateSettingsForm();
        this.addLog('info', 'Settings reset to defaults');
    }

    populateSettingsForm() {
        const elements = {
            'max-articles': this.settings.maxArticles,
            'days-back': this.settings.daysBack,
            'min-score': this.settings.minScore,
            'word-min': this.settings.wordMin,
            'word-max': this.settings.wordMax,
            'temperature': this.settings.temperature,
            'similarity': this.settings.similarity,
            'auto-publish': this.settings.autoPublish
        };
        
        Object.keys(elements).forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = elements[id];
                } else {
                    el.value = elements[id];
                }
            }
        });
    }

    addLog(type, message) {
        const logs = document.getElementById('logs-container');
        if (!logs) return;
        
        const time = new Date().toLocaleTimeString();
        const logClass = type === 'error' ? 'log-error' : 
                        type === 'success' ? 'log-success' : 
                        type === 'warning' ? 'log-warning' : '';
        
        const logLine = document.createElement('div');
        logLine.className = `log-line ${logClass}`;
        logLine.textContent = `[${time}] ${message}`;
        
        logs.appendChild(logLine);
        logs.scrollTop = logs.scrollHeight;
    }

    getTimeAgo(publishedAt) {
        if (!publishedAt) return 'Unknown time';
        const now = new Date();
        const pub = new Date(publishedAt);
        const hours = Math.floor((now - pub) / 3600000);
        const days = Math.floor(hours / 24);
        
        if (hours < 1) return 'Just published';
        if (hours < 24) return `${hours}h ago`;
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days}d ago`;
        return pub.toLocaleDateString();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    closeModal() {
        const modal = document.getElementById('edit-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // UI Methods
    renderArticles(filter = 'all') {
        const grid = document.getElementById('articles-grid');
        if (!grid) return;
        
        let articlesToShow = this.articles;
        
        // Apply filter
        if (filter === 'published') {
            articlesToShow = this.articles.filter(a => a.status === 'published' || a.order <= 6);
        } else if (filter === 'drafts') {
            articlesToShow = this.articles.filter(a => a.status === 'draft');
        } else if (filter === 'queue') {
            articlesToShow = this.articles.filter(a => a.status === 'queue' || (!a.preGeneratedAnalysis && !a.order));
        } else if (filter === 'rejected') {
            articlesToShow = this.articles.filter(a => a.status === 'rejected');
        }
        
        // Update filter button counts
        this.updateFilterCounts();
        
        if (articlesToShow.length === 0) {
            grid.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 40px;">No articles found</div>';
            return;
        }
        
        grid.innerHTML = articlesToShow.map((article, index) => {
            const realIndex = this.articles.indexOf(article);
            const safeIndex = String(realIndex);
            const safeTitle = this.escapeHtml(article.title || '');
            const safeDescription = this.escapeHtml(article.description || '');
            const safeMeta = this.escapeHtml(article.source?.name || 'Unknown Source');
            const timeAgo = this.getTimeAgo(article.publishedAt);
            const hasAnalysis = article.preGeneratedAnalysis;
            const statusClass = hasAnalysis ? 'status-success' : 'status-warning';
            const statusText = hasAnalysis ? 'Analysis Generated' : 'Using Fallback';
            const analysisContent = this.formatAnalysis(article.preGeneratedAnalysis || 'No analysis available');
            
            // Determine article status and actions
            const isPublished = article.status === 'published' || article.order <= 6;
            const isDraft = article.status === 'draft';
            const isQueue = article.status === 'queue' || (!hasAnalysis && !article.order);
            const isRejected = article.status === 'rejected';
            
            let statusBadge = '';
            if (isPublished) statusBadge = '<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 12px; font-size: 11px;">PUBLISHED</span>';
            else if (isDraft) statusBadge = '<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 12px; font-size: 11px;">DRAFT</span>';
            else if (isQueue) statusBadge = '<span style="background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 12px; font-size: 11px;">QUEUE</span>';
            else if (isRejected) statusBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 12px; font-size: 11px;">REJECTED</span>';
            
            let statusActions = '';
            if (isPublished) {
                statusActions = `<button class="btn btn-small btn-secondary" onclick="adminPanel.demoteArticle(${safeIndex})">⬇️ Demote</button>`;
            } else if (isDraft || isQueue) {
                statusActions = `<button class="btn btn-small" onclick="adminPanel.promoteArticle(${safeIndex})">⬆️ Promote</button>`;
            }
            
            return `
                <div class="article-card">
                    <div class="article-header">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <div class="article-title" style="flex: 1;">${safeTitle}</div>
                                ${statusBadge}
                            </div>
                            <div class="article-meta">
                                ${safeMeta} • ${timeAgo}
                            </div>
                        </div>
                        <div class="article-score">Score: ${article.score || '--'}</div>
                    </div>
                    
                    <div class="article-content">
                        <div class="article-description">
                            ${safeDescription}
                        </div>
                        
                        <div class="analysis-section">
                            <div class="analysis-status">
                                <span class="status-dot ${statusClass}"></span>
                                ${statusText}
                            </div>
                            <div class="analysis-label">Analysis</div>
                            <div class="analysis-content" id="analysis-${safeIndex}">
                                ${analysisContent}
                            </div>
                        </div>
                    </div>
                    
                    <div class="article-actions">
                        <button class="btn btn-small" onclick="adminPanel.editAnalysis(${safeIndex})">✏️ Edit</button>
                        <button class="btn btn-small btn-secondary" onclick="adminPanel.regenerateAnalysis(${safeIndex})">🔄 Regenerate</button>
                        ${statusActions}
                        <button class="btn btn-small btn-secondary" onclick="window.open('${this.escapeHtml(article.url || '')}', '_blank')">🔗 View Original</button>
                        <button class="btn btn-small btn-danger" onclick="adminPanel.removeArticle(${safeIndex})">🗑️ Remove</button>
                    </div>
                </div>
            `;
        }).join('');
        
        this.currentFilter = filter;
    }

    updateFilterCounts() {
        const published = this.articles.filter(a => a.status === 'published' || a.order <= 6).length;
        const drafts = this.articles.filter(a => a.status === 'draft').length;
        const queue = this.articles.filter(a => a.status === 'queue' || (!a.preGeneratedAnalysis && !a.order)).length;
        const rejected = this.articles.filter(a => a.status === 'rejected').length;
        
        const buttons = {
            'filter-all': `All Articles (${this.articles.length})`,
            'filter-published': `Published (${published})`,
            'filter-drafts': `Drafts (${drafts})`,
            'filter-queue': `Queue (${queue})`,
            'filter-rejected': `Rejected (${rejected})`
        };
        
        Object.keys(buttons).forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.textContent = buttons[id];
        });
    }

    formatAnalysis(text) {
        if (!text) return '<em>No analysis available</em>';
        return text.split('\n\n').map(p => `<p>${this.escapeHtml(p)}</p>`).join('');
    }

    updateStats() {
        const analyzed = this.articles.filter(a => a.preGeneratedAnalysis).length;
        const successRate = this.articles.length > 0 ? Math.round((analyzed / this.articles.length) * 100) : 0;
        
        const stats = {
            'stat-total': this.articles.length,
            'stat-analyzed': analyzed,
            'stat-success': `${successRate}%`
        };
        
        Object.keys(stats).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = stats[id];
        });
    }

    editAnalysis(index) {
        const article = this.articles[index];
        const modal = document.getElementById('edit-modal');
        const editor = document.getElementById('analysis-editor');
        
        if (editor && modal) {
            editor.value = article.preGeneratedAnalysis || '';
            editor.dataset.articleIndex = index;
            modal.style.display = 'block';
        }
    }

    async regenerateAnalysis(index) {
        const article = this.articles[index];
        this.addLog('info', `Regenerating analysis for: ${article.title.substring(0, 50)}...`);
        
        try {
            const response = await fetch(`${this.API_BASE}/api/personalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article })
            });
            
            const data = await response.json();
            if (data.impact) {
                this.articles[index].preGeneratedAnalysis = data.impact;
                this.addLog('success', 'Analysis regenerated successfully');
                
                this.renderArticles(this.currentFilter);
                this.updateStats();
                
                // Try to save to database if we have an article ID
                if (article.id) {
                    this.saveAnalysisToDatabase(article.id, data.impact);
                }
            } else {
                this.addLog('error', 'No analysis returned from API');
            }
        } catch (error) {
            this.addLog('error', 'Failed to regenerate analysis: ' + error.message);
        }
    }

    async saveAnalysisToDatabase(articleId, analysis) {
        try {
            await fetch(`${this.API_BASE}/api/admin?action=update-analysis`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.adminKey}`
                },
                body: JSON.stringify({ articleId, newAnalysis: analysis })
            });
        } catch (error) {
            this.addLog('warning', 'Failed to save to database: ' + error.message);
        }
    }

    async saveAnalysis() {
        const editor = document.getElementById('analysis-editor');
        const index = parseInt(editor.dataset.articleIndex);
        const newAnalysis = editor.value.trim();
        
        if (newAnalysis && this.articles[index]?.id) {
            try {
                const response = await fetch(`${this.API_BASE}/api/admin?action=update-analysis`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.adminKey}`
                    },
                    body: JSON.stringify({
                        articleId: this.articles[index].id,
                        newAnalysis: newAnalysis
                    })
                });
                
                if (response.ok) {
                    this.articles[index].preGeneratedAnalysis = newAnalysis;
                    this.renderArticles(this.currentFilter);
                    this.addLog('success', `Updated analysis for article ${index + 1}`);
                } else {
                    throw new Error('Failed to save analysis');
                }
            } catch (error) {
                this.addLog('error', 'Failed to save analysis: ' + error.message);
            }
        } else {
            // Local update only if no article ID
            this.articles[index].preGeneratedAnalysis = newAnalysis;
            this.renderArticles(this.currentFilter);
            this.addLog('warning', 'Updated locally only (no database save)');
        }
        
        this.closeModal();
    }

    promoteArticle(index) {
        this.articles[index].status = 'published';
        this.articles[index].order = this.articles.filter(a => a.status === 'published').length;
        this.addLog('success', `Promoted article to published`);
        this.renderArticles(this.currentFilter);
        this.updateStats();
    }

    demoteArticle(index) {
        this.articles[index].status = 'draft';
        delete this.articles[index].order;
        this.addLog('warning', `Demoted article to draft`);
        this.renderArticles(this.currentFilter);
        this.updateStats();
    }

    removeArticle(index) {
        if (confirm('Remove this article from today\'s edition?')) {
            this.articles.splice(index, 1);
            this.renderArticles(this.currentFilter);
            this.addLog('warning', `Removed article ${index + 1}`);
            this.updateStats();
        }
    }
}
