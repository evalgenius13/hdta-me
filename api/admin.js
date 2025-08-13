<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HDTA Admin Panel</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23374151'/><text x='50%' y='60%' text-anchor='middle' font-size='32' fill='white' font-family='system-ui'>⚙️</text></svg>">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: system-ui, -apple-system, sans-serif; 
            background: #f8fafc; 
            color: #1f2937; 
            line-height: 1.5;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        
        .header { 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); 
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 { font-size: 24px; font-weight: 700; }
        .status-badge { 
            padding: 6px 12px; 
            border-radius: 20px; 
            font-size: 14px; 
            font-weight: 600;
        }
        .status-live { background: #dcfce7; color: #166534; }

        .actions { 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); 
            margin-bottom: 20px;
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .btn { 
            background: #3b82f6; 
            color: white; 
            padding: 10px 16px; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 14px; 
            font-weight: 600;
            transition: background 0.2s;
        }
        .btn:hover { background: #2563eb; }
        .btn:disabled { background: #9ca3af; cursor: not-allowed; }
        .btn-secondary { background: #6b7280; }
        .btn-secondary:hover { background: #4b5563; }
        .btn-warning { background: #f59e0b; }
        .btn-warning:hover { background: #d97706; }
        .btn-danger { background: #dc2626; }
        .btn-danger:hover { background: #b91c1c; }

        .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 16px;
            margin-bottom: 20px;
        }
        .stat-card { 
            background: #f9fafb; 
            padding: 16px; 
            border-radius: 6px; 
            border: 1px solid #e5e7eb;
        }
        .stat-label { 
            font-size: 12px; 
            font-weight: 600; 
            text-transform: uppercase; 
            color: #6b7280; 
            margin-bottom: 4px;
        }
        .stat-value { 
            font-size: 24px; 
            font-weight: 700; 
            color: #111827;
        }

        .tabs { 
            display: flex; 
            gap: 4px; 
            margin-bottom: 20px;
        }
        .tab { 
            padding: 12px 20px; 
            background: white; 
            border: none; 
            cursor: pointer; 
            border-radius: 6px 6px 0 0;
            font-weight: 600;
            transition: all 0.2s;
        }
        .tab.active { background: #3b82f6; color: white; }
        .tab:not(.active):hover { background: #f1f5f9; }

        .panel { 
            background: white; 
            border-radius: 0 8px 8px 8px; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); 
            padding: 20px;
            display: none;
        }
        .panel.active { display: block; }

        .article-grid { display: grid; gap: 16px; }
        .article-card { 
            border: 1px solid #e5e7eb; 
            border-radius: 8px; 
            overflow: hidden;
            transition: box-shadow 0.2s;
        }
        .article-card:hover { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        
        .article-header { 
            padding: 16px; 
            border-bottom: 1px solid #f3f4f6;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
        }
        .article-title { 
            font-weight: 600; 
            font-size: 16px; 
            line-height: 1.4;
            flex: 1;
        }
        .article-meta { 
            font-size: 12px; 
            color: #6b7280; 
            margin-top: 4px;
        }
        .article-score { 
            background: #f3f4f6; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-size: 12px; 
            font-weight: 600;
            white-space: nowrap;
        }

        .article-content { padding: 16px; }
        .article-description { 
            color: #4b5563; 
            font-size: 14px; 
            margin-bottom: 12px;
            line-height: 1.5;
        }

        .analysis-section { margin-top: 12px; }
        .analysis-label { 
            font-size: 12px; 
            font-weight: 600; 
            text-transform: uppercase; 
            color: #374151; 
            margin-bottom: 6px;
        }
        .analysis-content { 
            background: #f9fafb; 
            padding: 12px; 
            border-radius: 6px; 
            font-size: 14px; 
            line-height: 1.6;
        }
        .analysis-status { 
            display: inline-flex; 
            align-items: center; 
            gap: 6px; 
            font-size: 12px; 
            margin-bottom: 8px;
        }
        .status-dot { 
            width: 8px; 
            height: 8px; 
            border-radius: 50%; 
        }
        .status-success { background: #10b981; }
        .status-warning { background: #f59e0b; }

        .article-actions { 
            padding: 12px 16px; 
            background: #f9fafb; 
            border-top: 1px solid #f3f4f6;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .btn-small { 
            padding: 6px 12px; 
            font-size: 12px; 
        }

        .article-filter-tabs { 
            margin-bottom: 16px; 
            display: flex; 
            gap: 8px; 
            flex-wrap: wrap;
        }

        .logs { 
            background: #1f2937; 
            color: #f9fafb; 
            padding: 16px; 
            border-radius: 8px; 
            font-family: 'Courier New', monospace; 
            font-size: 13px; 
            height: 400px; 
            overflow-y: auto;
        }
        .log-line { margin-bottom: 4px; }
        .log-error { color: #fca5a5; }
        .log-success { color: #86efac; }
        .log-warning { color: #fcd34d; }

        .loading { 
            text-align: center; 
            padding: 40px; 
            color: #6b7280;
        }
        .spinner { 
            width: 20px; 
            height: 20px; 
            border: 2px solid #e5e7eb; 
            border-top: 2px solid #3b82f6; 
            border-radius: 50%; 
            animation: spin 1s linear infinite; 
            display: inline-block; 
            margin-right: 8px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .modal { 
            display: none; 
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%; 
            background: rgba(0,0,0,0.5); 
            z-index: 1000;
        }
        .modal-content { 
            background: white; 
            margin: 50px auto; 
            padding: 20px; 
            border-radius: 8px; 
            max-width: 600px; 
            max-height: 80vh; 
            overflow-y: auto;
        }
        .modal-header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-bottom: 20px;
        }
        .modal-title { font-size: 18px; font-weight: 600; }
        .close-btn { 
            background: none; 
            border: none; 
            font-size: 24px; 
            cursor: pointer; 
            color: #6b7280;
        }
        .close-btn:hover { color: #374151; }

        textarea { 
            width: 100%; 
            min-height: 200px; 
            padding: 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 6px; 
            font-family: inherit; 
            resize: vertical;
        }

        .error-banner {
            background: #fee2e2;
            border: 1px solid #fecaca;
            color: #991b1b;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
        }

        .success-banner {
            background: #dcfce7;
            border: 1px solid #bbf7d0;
            color: #166534;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>HDTA Admin Panel</h1>
                <div class="status-badge status-live">News Management</div>
            </div>
            <div id="edition-info">Loading...</div>
        </div>

        <div class="actions">
            <button class="btn" onclick="fetchFreshArticles()">🔄 Fetch Fresh Articles</button>
            <button class="btn btn-warning" onclick="forceRefetch()">🚀 Force Refetch (Replace All)</button>
            <button class="btn btn-secondary" onclick="refreshData()">📊 Reload Data</button>
            <button class="btn btn-danger" onclick="clearToday()">🗑️ Clear Today's Edition</button>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Articles</div>
                <div class="stat-value" id="stat-total">--</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Published</div>
                <div class="stat-value" id="stat-published">--</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Queued</div>
                <div class="stat-value" id="stat-queued">--</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">With Analysis</div>
                <div class="stat-value" id="stat-analyzed">--</div>
            </div>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="showTab('articles')">📰 Articles</button>
            <button class="tab" onclick="showTab('prompts')">🎯 Prompts</button>
            <button class="tab" onclick="showTab('logs')">📋 Logs</button>
        </div>

        <div id="articles-panel" class="panel active">
            <div class="article-filter-tabs">
                <button class="btn btn-small" id="filter-all" onclick="filterArticles('all')">All Articles</button>
                <button class="btn btn-small btn-secondary" id="filter-published" onclick="filterArticles('published')">Published</button>
                <button class="btn btn-small btn-secondary" id="filter-queue" onclick="filterArticles('queue')">Queue</button>
                <button class="btn btn-small btn-secondary" id="filter-drafts" onclick="filterArticles('drafts')">Drafts</button>
                <button class="btn btn-small btn-secondary" id="filter-rejected" onclick="filterArticles('rejected')">Rejected</button>
            </div>
            
            <div class="loading" id="articles-loading">
                <span class="spinner"></span>
                Loading articles...
            </div>
            <div class="article-grid" id="articles-grid" style="display: none;"></div>
        </div>

        <div id="logs-panel" class="panel">
            <div style="margin-bottom: 12px;">
                <button class="btn btn-secondary btn-small" onclick="refreshLogs()">🔄 Refresh</button>
                <button class="btn btn-secondary btn-small" onclick="clearLogs()">🗑️ Clear</button>
            </div>
            <div class="logs" id="logs-container">
                <div class="log-line log-success">[System] Admin panel ready</div>
            </div>
        </div>
    </div>

    <!-- Modal for editing analysis -->
    <div id="edit-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title">Edit Analysis</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div>
                <textarea id="analysis-editor" placeholder="Edit the analysis content..."></textarea>
                <div style="margin-top: 12px;">
                    <button class="btn" onclick="saveAnalysis()">💾 Save</button>
                    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // FIXED AdminPanel - Database persistence and error handling
        class AdminPanel {
            constructor() {
                this.API_BASE = ''; // Relative URLs
                this.articles = [];
                this.adminKey = 'hdta-admin-2025-temp';
                this.currentFilter = 'all';
                this.currentEditIndex = null;
            }

            async init() {
                await this.loadData();
                this.updateStats();
                this.addLog('success', 'Admin panel initialized');
            }

            async loadData() {
                try {
                    this.addLog('info', 'Loading articles from database...');
                    
                    const response = await fetch(`${this.API_BASE}/api/admin?action=get-articles`, {
                        headers: { 'Authorization': `Bearer ${this.adminKey}` }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    this.articles = data.articles || [];
                    
                    // Update edition info
                    if (data.edition) {
                        document.getElementById('edition-info').textContent = 
                            `Issue #${data.edition.issue_number} • ${data.edition.date}`;
                    } else {
                        document.getElementById('edition-info').textContent = 'No edition found';
                    }
                    
                    this.renderArticles();
                    document.getElementById('articles-loading').style.display = 'none';
                    document.getElementById('articles-grid').style.display = 'grid';
                    
                    this.addLog('success', `Loaded ${this.articles.length} articles`);
                    
                } catch (error) {
                    console.error('Failed to load articles:', error);
                    this.addLog('error', 'Failed to load articles: ' + error.message);
                    this.showErrorState(error.message);
                }
            }

            showErrorState(message) {
                const loading = document.getElementById('articles-loading');
                loading.innerHTML = `
                    <div class="error-banner">
                        <div style="font-weight: 600; margin-bottom: 8px;">⚠️ Failed to Load Articles</div>
                        <div style="font-size: 14px; margin-bottom: 12px;">${this.escapeHtml(message)}</div>
                        <button class="btn" onclick="adminPanel.loadData()">🔄 Retry</button>
                        <button class="btn btn-warning" onclick="fetchFreshArticles()" style="margin-left: 8px;">🚀 Fetch Fresh Articles</button>
                    </div>
                `;
            }

            renderArticles(filter = 'all') {
                const grid = document.getElementById('articles-grid');
                if (!grid) return;
                
                let articlesToShow = this.articles;
                
                // Apply filter
                if (filter === 'published') {
                    articlesToShow = this.articles.filter(a => a.status === 'published');
                } else if (filter === 'queue') {
                    articlesToShow = this.articles.filter(a => a.status === 'queue');
                } else if (filter === 'drafts') {
                    articlesToShow = this.articles.filter(a => a.status === 'draft');
                } else if (filter === 'rejected') {
                    articlesToShow = this.articles.filter(a => a.status === 'rejected');
                }
                
                this.updateFilterButtons(filter);
                this.currentFilter = filter;
                
                if (articlesToShow.length === 0) {
                    grid.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 40px;">No articles found for this filter</div>';
                    return;
                }
                
                grid.innerHTML = articlesToShow.map((article, index) => {
                    const realIndex = this.articles.indexOf(article);
                    const safeTitle = this.escapeHtml(article.title || '');
                    const safeDescription = this.escapeHtml(article.description || '');
                    const safeMeta = this.escapeHtml(article.source?.name || 'Unknown Source');
                    const timeAgo = this.getTimeAgo(article.publishedAt);
                    const hasAnalysis = article.preGeneratedAnalysis;
                    const statusClass = hasAnalysis ? 'status-success' : 'status-warning';
                    const statusText = hasAnalysis ? 'Analysis Generated' : 'No Analysis';
                    const analysisContent = this.formatAnalysis(article.preGeneratedAnalysis || 'No analysis available');
                    
                    // Status badge
                    let statusBadge = '';
                    switch (article.status) {
                        case 'published':
                            statusBadge = '<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 12px; font-size: 11px;">PUBLISHED</span>';
                            break;
                        case 'draft':
                            statusBadge = '<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 12px; font-size: 11px;">DRAFT</span>';
                            break;
                        case 'queue':
                            statusBadge = '<span style="background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 12px; font-size: 11px;">QUEUE</span>';
                            break;
                        case 'rejected':
                            statusBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 12px; font-size: 11px;">REJECTED</span>';
                            break;
                        default:
                            statusBadge = '<span style="background: #f3f4f6; color: #6b7280; padding: 2px 6px; border-radius: 12px; font-size: 11px;">UNKNOWN</span>';
                    }
                    
                    // Status actions
                    let statusActions = '';
                    if (article.status === 'published') {
                        statusActions = `<button class="btn btn-small btn-secondary" onclick="adminPanel.demoteArticle(${realIndex})">⬇️ Move to Queue</button>`;
                    } else if (article.status === 'queue' || article.status === 'draft') {
                        statusActions = `<button class="btn btn-small" onclick="adminPanel.promoteArticle(${realIndex})">⬆️ Publish</button>`;
                    } else if (article.status === 'rejected') {
                        statusActions = `<button class="btn btn-small" onclick="adminPanel.restoreArticle(${realIndex})">↩️ Restore</button>`;
                    }
                    
                    return `
                        <div class="article-card">
                            <div class="article-header">
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                        <div class="article-title">${safeTitle}</div>
                                        ${statusBadge}
                                    </div>
                                    <div class="article-meta">
                                        ${safeMeta} • ${timeAgo} • Order: ${article.order || realIndex + 1}
                                    </div>
                                </div>
                                <div class="article-score">Score: ${article.score || '--'}</div>
                            </div>
                            
                            <div class="article-content">
                                <div class="article-description">${safeDescription}</div>
                                
                                <div class="analysis-section">
                                    <div class="analysis-status">
                                        <span class="status-dot ${statusClass}"></span>
                                        ${statusText}
                                    </div>
                                    <div class="analysis-label">Analysis</div>
                                    <div class="analysis-content">${analysisContent}</div>
                                </div>
                            </div>
                            
                            <div class="article-actions">
                                <button class="btn btn-small" onclick="adminPanel.editAnalysis(${realIndex})">✏️ Edit Analysis</button>
                                <button class="btn btn-small btn-secondary" onclick="adminPanel.regenerateAnalysis(${realIndex})">🔄 Regenerate</button>
                                ${statusActions}
                                <button class="btn btn-small btn-secondary" onclick="window.open('${this.escapeHtml(article.url || '')}', '_blank')">🔗 View Original</button>
                                <button class="btn btn-small btn-danger" onclick="adminPanel.removeArticle(${realIndex})">🗑️ Remove</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            updateFilterButtons(activeFilter) {
                const published = this.articles.filter(a => a.status === 'published').length;
                const queue = this.articles.filter(a => a.status === 'queue').length;
                const drafts = this.articles.filter(a => a.status === 'draft').length;
                const rejected = this.articles.filter(a => a.status === 'rejected').length;
                
                const buttons = {
                    'filter-all': `All Articles (${this.articles.length})`,
                    'filter-published': `Published (${published})`,
                    'filter-queue': `Queue (${queue})`,
                    'filter-drafts': `Drafts (${drafts})`,
                    'filter-rejected': `Rejected (${rejected})`
                };
                
                Object.keys(buttons).forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.textContent = buttons[id];
                        if (id.includes(activeFilter)) {
                            btn.classList.remove('btn-secondary');
                        } else {
                            btn.classList.add('btn-secondary');
                        }
                    }
                });
            }

            updateStats() {
                const published = this.articles.filter(a => a.status === 'published').length;
                const queue = this.articles.filter(a => a.status === 'queue').length;
                const analyzed = this.articles.filter(a => a.preGeneratedAnalysis).length;
                
                document.getElementById('stat-total').textContent = this.articles.length;
                document.getElementById('stat-published').textContent = published;
                document.getElementById('stat-queued').textContent = queue;
                document.getElementById('stat-analyzed').textContent = analyzed;
            }

            formatAnalysis(text) {
                if (!text) return '<em>No analysis available</em>';
                return text.split('\n\n').map(p => `<p>${this.escapeHtml(p)}</p>`).join('');
            }

            editAnalysis(index) {
                this.currentEditIndex = index;
                const article = this.articles[index];
                const modal = document.getElementById('edit-modal');
                const editor = document.getElementById('analysis-editor');
                
                if (editor && modal) {
                    editor.value = article.preGeneratedAnalysis || '';
                    modal.style.display = 'block';
                }
            }

            // FIXED: Save analysis to database
            async saveAnalysis() {
                if (this.currentEditIndex === null) return;
                
                const editor = document.getElementById('analysis-editor');
                const newAnalysis = editor.value.trim();
                const article = this.articles[this.currentEditIndex];
                
                if (!newAnalysis) {
                    this.addLog('error', 'Analysis cannot be empty');
                    return;
                }

                if (!article.id) {
                    this.addLog('error', 'Article ID missing - cannot save to database');
                    return;
                }

                try {
                    this.addLog('info', 'Saving analysis to database...');
                    
                    const response = await fetch(`${this.API_BASE}/api/admin?action=update-analysis`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.adminKey}`
                        },
                        body: JSON.stringify({
                            articleId: article.id,
                            newAnalysis: newAnalysis
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const result = await response.json();
                    
                    // Update local copy
                    this.articles[this.currentEditIndex].preGeneratedAnalysis = newAnalysis;
                    this.renderArticles(this.currentFilter);
                    this.closeModal();
                    
                    this.addLog('success', `Analysis saved successfully (${result.wordCount} words)`);
                    
                } catch (error) {
                    console.error('Failed to save analysis:', error);
                    this.addLog('error', 'Failed to save analysis: ' + error.message);
                }
            }

            async regenerateAnalysis(index) {
                const article = this.articles[index];
                this.addLog('info', `Regenerating analysis: ${article.title.substring(0, 50)}...`);
                
                try {
                    const response = await fetch(`${this.API_BASE}/api/personalize`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ article })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    if (data.impact) {
                        // Update locally first
                        this.articles[index].preGeneratedAnalysis = data.impact;
                        this.renderArticles(this.currentFilter);
                        
                        // Save to database if we have article ID
                        if (article.id) {
                            await this.saveAnalysisToDatabase(article.id, data.impact);
                        }
                        
                        this.addLog('success', 'Analysis regenerated successfully');
                    } else {
                        this.addLog('error', 'No analysis returned from API');
                    }
                } catch (error) {
                    console.error('Failed to regenerate analysis:', error);
                    this.addLog('error', 'Failed to regenerate: ' + error.message);
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
                    this.addLog('warning', 'Failed to save regenerated analysis to database');
                }
            }

            // FIXED: Promote article with database persistence
            async promoteArticle(index) {
                const article = this.articles[index];
                
                if (!article.id) {
                    this.addLog('error', 'Article ID missing - cannot update status');
                    return;
                }

                try {
                    this.addLog('info', `Publishing article: ${article.title.substring(0, 30)}...`);
                    
                    const response = await fetch(`${this.API_BASE}/api/admin?action=update-status`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.adminKey}`
                        },
                        body: JSON.stringify({
                            articleId: article.id,
                            status: 'published'
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    // Update local copy
                    this.articles[index].status = 'published';
                    this.renderArticles(this.currentFilter);
                    this.updateStats();
                    
                    this.addLog('success', `Published: ${article.title.substring(0, 30)}...`);
                    
                } catch (error) {
                    console.error('Failed to promote article:', error);
                    this.addLog('error', 'Failed to publish article: ' + error.message);
                }
            }

            // FIXED: Demote article with database persistence
            async demoteArticle(index) {
                const article = this.articles[index];
                
                if (!article.id) {
                    this.addLog('error', 'Article ID missing - cannot update status');
                    return;
                }

                try {
                    this.addLog('info', `Moving to queue: ${article.title.substring(0, 30)}...`);
                    
                    const response = await fetch(`${this.API_BASE}/api/admin?action=update-status`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.adminKey}`
                        },
                        body: JSON.stringify({
                            articleId: article.id,
                            status: 'queue'
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    // Update local copy
                    this.articles[index].status = 'queue';
                    this.renderArticles(this.currentFilter);
                    this.updateStats();
                    
                    this.addLog('warning', `Moved to queue: ${article.title.substring(0, 30)}...`);
                    
                } catch (error) {
                    console.error('Failed to demote article:', error);
                    this.addLog('error', 'Failed to move article: ' + error.message);
                }
            }

            // NEW: Restore rejected article
            async restoreArticle(index) {
                const article = this.articles[index];
                
                if (!article.id) {
                    this.addLog('error', 'Article ID missing - cannot update status');
                    return;
                }

                try {
                    const response = await fetch(`${this.API_BASE}/api/admin?action=update-status`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.adminKey}`
                        },
                        body: JSON.stringify({
                            articleId: article.id,
                            status: 'queue'
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    this.articles[index].status = 'queue';
                    this.renderArticles(this.currentFilter);
                    this.updateStats();
                    
                    this.addLog('success', `Restored: ${article.title.substring(0, 30)}...`);
                    
                } catch (error) {
                    console.error('Failed to restore article:', error);
                    this.addLog('error', 'Failed to restore article: ' + error.message);
                }
            }

            // FIXED: Remove article with database persistence
            async removeArticle(index) {
                const article = this.articles[index];
                
                if (!confirm('Remove this article permanently?')) return;
                
                if (!article.id) {
                    this.addLog('error', 'Article ID missing - cannot remove from database');
                    return;
                }

                try {
                    this.addLog('warning', `Removing article: ${article.title.substring(0, 30)}...`);
                    
                    const response = await fetch(`${this.API_BASE}/api/admin?action=remove-article`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.adminKey}`
                        },
                        body: JSON.stringify({
                            articleId: article.id
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    // Remove from local array
                    const title = this.articles[index].title.substring(0, 30);
                    this.articles.splice(index, 1);
                    this.renderArticles(this.currentFilter);
                    this.updateStats();
                    
                    this.addLog('warning', `Removed: ${title}...`);
                    
                } catch (error) {
                    console.error('Failed to remove article:', error);
                    this.addLog('error', 'Failed to remove article: ' + error.message);
                }
            }

            addLog(type, message) {
                const logs = document.getElementById('logs-container');
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
                document.getElementById('edit-modal').style.display = 'none';
                this.currentEditIndex = null;
            }
        }

        // Global functions for UI with proper error handling
        function showTab(tabName) {
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            
            const panel = document.getElementById(`${tabName}-panel`);
            if (panel) panel.classList.add('active');
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(tab => {
                if (tab.textContent.includes(tabName === 'articles' ? '📰' : '📋')) {
                    tab.classList.add('active');
                }
            });
        }

        function filterArticles(filter) {
            if (window.adminPanel) {
                adminPanel.renderArticles(filter);
            }
        }

        // ENHANCED: Fetch fresh articles with proper error handling
        async function fetchFreshArticles() {
            if (!window.adminPanel) return;
            
            try {
                adminPanel.addLog('info', 'Fetching fresh articles (preserves existing if today\'s edition exists)...');
                
                const response = await fetch('/api/manual-trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trigger_key: 'force-update-2025' })
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                if (data.success) {
                    adminPanel.addLog('success', `${data.processing.action} - ${data.processing.articles_total} articles`);
                    await adminPanel.loadData();
                    adminPanel.updateStats();
                } else {
                    adminPanel.addLog('error', 'Failed: ' + data.error);
                }
            } catch (error) {
                console.error('Fetch fresh articles failed:', error);
                adminPanel.addLog('error', 'Request failed: ' + error.message);
            }
        }

        // ENHANCED: Force refetch with confirmation and error handling
        async function forceRefetch() {
            if (!confirm('Force refetch will DELETE all of today\'s articles and fetch completely fresh ones. Continue?')) return;
            
            if (!window.adminPanel) return;
            
            try {
                adminPanel.addLog('warning', 'Force refetching - replacing all articles...');
                
                const response = await fetch('/api/manual-trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        trigger_key: 'force-update-2025',
                        force_refetch: true 
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                if (data.success) {
                    adminPanel.addLog('success', `Refetched - ${data.processing.articles_total} fresh articles`);
                    await adminPanel.loadData();
                    adminPanel.updateStats();
                } else {
                    adminPanel.addLog('error', 'Failed: ' + data.error);
                }
            } catch (error) {
                console.error('Force refetch failed:', error);
                adminPanel.addLog('error', 'Request failed: ' + error.message);
            }
        }

        async function refreshData() {
            if (!window.adminPanel) return;
            
            try {
                adminPanel.addLog('info', 'Refreshing data from database...');
                await adminPanel.loadData();
                adminPanel.updateStats();
                adminPanel.addLog('success', 'Data refreshed');
            } catch (error) {
                console.error('Refresh data failed:', error);
                adminPanel.addLog('error', 'Refresh failed: ' + error.message);
            }
        }

        async function clearToday() {
            if (!confirm('Clear today\'s edition? This will DELETE all articles and cannot be undone.')) return;
            
            if (!window.adminPanel) return;
            
            try {
                adminPanel.addLog('warning', 'Clearing today\'s edition...');
                
                const response = await fetch('/api/admin?action=clear-today', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${window.adminPanel.adminKey}`
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                adminPanel.articles = [];
                adminPanel.renderArticles();
                adminPanel.updateStats();
                adminPanel.addLog('success', 'Edition cleared successfully');
                
            } catch (error) {
                console.error('Clear today failed:', error);
                adminPanel.addLog('error', 'Failed to clear: ' + error.message);
            }
        }

        function refreshLogs() {
            if (window.adminPanel) {
                adminPanel.addLog('info', 'Logs refreshed');
            }
        }

        function clearLogs() {
            const logsContainer = document.getElementById('logs-container');
            if (logsContainer) {
                logsContainer.innerHTML = '<div class="log-line log-success">[System] Logs cleared</div>';
            }
        }

        function closeModal() {
            document.getElementById('edit-modal').style.display = 'none';
            if (window.adminPanel) {
                adminPanel.currentEditIndex = null;
            }
        }

        function saveAnalysis() {
            if (window.adminPanel) {
                adminPanel.saveAnalysis();
            }
        }

        // Initialize admin panel
        let adminPanel;

        document.addEventListener('DOMContentLoaded', async () => {
            try {
                adminPanel = new AdminPanel();
                window.adminPanel = adminPanel;
                await adminPanel.init();
                console.log('✅ Admin panel initialized with database persistence');
            } catch (error) {
                console.error('❌ Failed to initialize admin panel:', error);
            }
        });
    </script>
</body>
</html>
