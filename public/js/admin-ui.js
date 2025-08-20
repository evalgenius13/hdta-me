// admin-ui.js - UI rendering and article management with images - FIXED
AdminPanel.prototype.renderArticles = function(filter = 'all') {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;
    
    let articlesToShow = this.articles;
    
    // Simple filter logic
    if (filter === 'published') {
        articlesToShow = this.articles.filter(a => a.status === 'published');
    } else if (filter === 'drafts') {
        articlesToShow = this.articles.filter(a => a.status === 'draft');
    } else if (filter === 'queue') {
        articlesToShow = this.articles.filter(a => a.status === 'queue');
    } else if (filter === 'rejected') {
        articlesToShow = this.articles.filter(a => a.status === 'rejected');
    }
    
    this.updateFilterCounts();
    
    grid.innerHTML = articlesToShow.map((article) => {
        const articleId = article.id;
        const safeTitle = this.escapeHtml(article.title || '');
        const safeDescription = this.escapeHtml(article.description || '');
        const safeMeta = this.escapeHtml(article.source?.name || 'Unknown Source');
        const safeUrl = this.escapeHtml(article.url || '');
        const imageUrl = article.urlToImage || article.image_url;
        const timeAgo = this.getTimeAgo(article.publishedAt);
        const hasAnalysis = article.preGeneratedAnalysis && 
                           article.preGeneratedAnalysis !== 'No analysis available' &&
                           article.preGeneratedAnalysis.trim() !== '';
        const statusClass = hasAnalysis ? 'status-success' : 'status-warning';
        const statusText = hasAnalysis ? 'Analysis Generated' : 'No Analysis';
        const analysisContent = this.formatAnalysis(article.preGeneratedAnalysis || 'No analysis available');
        
        let statusBadge = '';
        if (article.status === 'published') statusBadge = '<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 12px; font-size: 11px;">PUBLISHED</span>';
        else if (article.status === 'draft') statusBadge = '<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 12px; font-size: 11px;">DRAFT</span>';
        else if (article.status === 'queue') statusBadge = '<span style="background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 12px; font-size: 11px;">QUEUE</span>';
        else if (article.status === 'rejected') statusBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 12px; font-size: 11px;">REJECTED</span>';
        
        let statusActions = '';
        if (article.status === 'published') {
            statusActions = `<button class="btn btn-small btn-secondary" onclick="adminPanel.demoteArticle('${articleId}')">⬇️ Demote</button>`;
        } else {
            statusActions = `<button class="btn btn-small" onclick="adminPanel.promoteArticle('${articleId}')">⬆️ Promote</button>`;
        }
        
        const analyzeText = hasAnalysis ? '✅ Analyzed' : '🧠 Analyze';
        
        return `
            <div class="article-card">
                <div class="article-image">
                    ${imageUrl ? 
                        `<img src="${this.escapeHtml(imageUrl)}" alt="Article image" onerror="this.style.display='none'; this.parentElement.innerHTML='📰';">` : 
                        '📰'
                    }
                </div>
                
                <div class="article-body">
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
                            <div class="analysis-content">
                                ${analysisContent}
                            </div>
                        </div>
                    </div>
                    
                    <div class="article-actions">
                        <button class="btn btn-small" onclick="adminPanel.editAnalysis('${articleId}')">✏️ Edit</button>
                        <button class="btn btn-small btn-warning" onclick="adminPanel.analyzeArticle('${articleId}')">${analyzeText}</button>
                        ${statusActions}
                        <button class="btn btn-small btn-secondary" onclick="window.open('${safeUrl}', '_blank')">🔗 View Original</button>
                        <button class="btn btn-small btn-danger" onclick="adminPanel.removeArticle('${articleId}')">🗑️ Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    this.currentFilter = filter;
};

AdminPanel.prototype.updateFilterCounts = function() {
    const published = this.articles.filter(a => a.status === 'published').length;
    const drafts = this.articles.filter(a => a.status === 'draft').length;
    const queue = this.articles.filter(a => a.status === 'queue').length;
    const rejected = this.articles.filter(a => a.status === 'rejected').length;
    
    const publishedBtn = document.getElementById('filter-published');
    const draftsBtn = document.getElementById('filter-drafts');
    const queueBtn = document.getElementById('filter-queue');
    const rejectedBtn = document.getElementById('filter-rejected');
    const allBtn = document.getElementById('filter-all');
    
    if (publishedBtn) publishedBtn.textContent = `Published (${published})`;
    if (draftsBtn) draftsBtn.textContent = `Drafts (${drafts})`;
    if (queueBtn) queueBtn.textContent = `Queue (${queue})`;
    if (rejectedBtn) rejectedBtn.textContent = `Rejected (${rejected})`;
    if (allBtn) allBtn.textContent = `All Articles (${this.articles.length})`;
};

AdminPanel.prototype.formatAnalysis = function(text) {
    if (!text || text === 'No analysis available') return '<em>No analysis available</em>';
    return text.split('\n\n').map(p => `<p>${this.escapeHtml(p)}</p>`).join('');
};

AdminPanel.prototype.updateStats = function() {
    const analyzed = this.articles.filter(a => a.preGeneratedAnalysis && a.preGeneratedAnalysis !== 'No analysis available').length;
    const published = this.articles.filter(a => a.status === 'published').length;
    const queue = this.articles.filter(a => a.status === 'queue').length;
    
    const statTotal = document.getElementById('stat-total');
    const statPublished = document.getElementById('stat-published');
    const statQueued = document.getElementById('stat-queued');
    const statAnalyzed = document.getElementById('stat-analyzed');
    
    if (statTotal) statTotal.textContent = this.articles.length;
    if (statPublished) statPublished.textContent = published;
    if (statQueued) statQueued.textContent = queue;
    if (statAnalyzed) statAnalyzed.textContent = analyzed;
};

AdminPanel.prototype.editAnalysis = function(articleId) {
    const article = this.articles.find(a => a.id === articleId);
    if (!article) return;
    
    const modal = document.getElementById('edit-modal');
    const editor = document.getElementById('analysis-editor');
    
    if (editor && modal) {
        editor.value = article.preGeneratedAnalysis || '';
        editor.dataset.articleId = articleId;
        modal.style.display = 'block';
    }
};

AdminPanel.prototype.promoteArticle = function(articleId) {
    const article = this.articles.find(a => a.id === articleId);
    if (!article) return;
    
    // Update database
    fetch('/api/admin?action=update-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.adminKey || 'hdta-admin-2025-temp'}`
        },
        body: JSON.stringify({ 
            articleId: articleId,
            status: 'published' 
        })
    }).then(response => {
        if (response.ok) {
            article.status = 'published';
            this.renderArticles(this.currentFilter);
            this.updateStats();
        }
    });
};

AdminPanel.prototype.demoteArticle = function(articleId) {
    const article = this.articles.find(a => a.id === articleId);
    if (!article) return;
    
    // Update database
    fetch('/api/admin?action=update-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.adminKey || 'hdta-admin-2025-temp'}`
        },
        body: JSON.stringify({ 
            articleId: articleId,
            status: 'queue' 
        })
    }).then(response => {
        if (response.ok) {
            article.status = 'queue';
            this.renderArticles(this.currentFilter);
            this.updateStats();
        }
    });
};

AdminPanel.prototype.removeArticle = function(articleId) {
    // Change status to 'rejected' - no confirm dialog
    fetch('/api/admin?action=update-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.adminKey || 'hdta-admin-2025-temp'}`
        },
        body: JSON.stringify({ 
            articleId: articleId,
            status: 'rejected' 
        })
    }).then(response => {
        if (response.ok) {
            // Update local copy
            const article = this.articles.find(a => a.id === articleId);
            if (article) {
                article.status = 'rejected';
                this.renderArticles(this.currentFilter);
                this.updateStats();
            }
        }
    });
};

AdminPanel.prototype.analyzeArticle = async function(articleId) {
    const article = this.articles.find(a => a.id === articleId);
    if (!article) return;

    try {
        if (this.addLog) this.addLog('info', 'Analyzing article...');
        
        const response = await fetch('/api/admin?action=generate-analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.adminKey || 'hdta-admin-2025-temp'}`
            },
            body: JSON.stringify({ article })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.analysis) {
                article.preGeneratedAnalysis = result.analysis;
                this.renderArticles(this.currentFilter);
                if (this.addLog) this.addLog('success', 'Analysis generated');
            }
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        if (this.addLog) this.addLog('error', 'Analysis failed: ' + error.message);
    }
};
