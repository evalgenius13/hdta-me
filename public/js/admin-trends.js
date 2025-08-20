// admin-trends.js - Weekly Trend Analysis Module
// Adds trend analysis functionality to the weekly admin panel

// Extend AdminPanel with trends functionality
AdminPanel.prototype.loadTrends = async function() {
    const trendsLoading = document.getElementById('trends-loading');
    const trendsContainer = document.getElementById('trends-container');
    const trendsStatus = document.getElementById('trends-status');
    
    if (!trendsLoading || !trendsContainer || !trendsStatus) {
        console.error('Trends UI elements not found');
        return;
    }
    
    trendsLoading.style.display = 'block';
    trendsContainer.style.display = 'none';
    trendsStatus.textContent = 'Loading trend analysis...';
    
    try {
        this.addLog('info', 'Loading weekly trend analysis...');
        
        const response = await fetch(`${this.API_BASE}/api/admin?action=get-trends`, {
            headers: { 'Authorization': `Bearer ${this.adminKey}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Trends API returned success=false');
        }
        
        this.trendsData = data.trends;
        
        this.renderTrends();
        trendsLoading.style.display = 'none';
        trendsContainer.style.display = 'block';
        trendsStatus.textContent = `Analysis complete • ${this.trendsData.total_articles} articles analyzed`;
        
        this.addLog('success', `Loaded trend analysis: ${this.trendsData.top_keywords.length} trending topics`);
        
    } catch (error) {
        console.error('Failed to load trends:', error);
        this.addLog('error', 'Failed to load trends: ' + error.message);
        
        trendsLoading.style.display = 'none';
        trendsContainer.style.display = 'block';
        trendsContainer.innerHTML = this.getTrendsErrorHTML(error.message);
        trendsStatus.textContent = 'Failed to load trends';
    }
};

AdminPanel.prototype.getTrendsErrorHTML = function(errorMessage) {
    return `
        <div style="text-align: center; color: #dc2626; padding: 40px;">
            <div style="font-size: 18px; margin-bottom: 8px;">⚠️ Failed to Load Trends</div>
            <div style="font-size: 14px; margin-bottom: 12px;">${this.escapeHtml(errorMessage)}</div>
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 16px;">
                Make sure the enhanced weekly workflow is running and has generated trend data.
            </div>
            <button class="btn" onclick="refreshTrends()">🔄 Try Again</button>
        </div>
    `;
};

AdminPanel.prototype.renderTrends = function() {
    if (!this.trendsData) {
        const container = document.getElementById('trends-container');
        if (container) {
            container.innerHTML = '<p>No trend data available</p>';
        }
        return;
    }

    const container = document.getElementById('trends-container');
    if (!container) {
        console.error('Trends container not found');
        return;
    }
    
    // Build trend context display (what gets sent to GPT)
    let trendContext = '';
    if (this.trendsData.top_keywords && this.trendsData.top_keywords.length > 0) {
        const topicBriefs = this.trendsData.top_keywords
            .filter(t => t.count >= 3)
            .slice(0, 8)
            .map(t => `${t.keyword} (${t.count} mentions)`);
        
        if (topicBriefs.length > 0) {
            trendContext = `This week's trending policy topics: ${topicBriefs.join(', ')}`;
        }
    }

    // Overview section
    let html = `
        <div class="trends-overview">
            <h3 style="margin-bottom: 12px; color: #1f2937;">📊 Weekly Trend Overview</h3>
            <div class="stats-grid" style="margin-bottom: 16px;">
                <div class="stat-card">
                    <div class="stat-label">Articles Analyzed</div>
                    <div class="stat-value">${this.trendsData.total_articles || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Trending Topics</div>
                    <div class="stat-value">${(this.trendsData.top_keywords || []).filter(t => t.count >= 3).length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">News Sources</div>
                    <div class="stat-value">${(this.trendsData.top_sources || []).length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Days Covered</div>
                    <div class="stat-value">${Object.keys(this.trendsData.daily_counts || {}).length}</div>
                </div>
            </div>
            
            ${trendContext ? `
            <div>
                <div class="trend-context-label">Generated Trend Context (sent to GPT)</div>
                <div class="trend-context-display">${this.escapeHtml(trendContext)}</div>
            </div>
            ` : '<p style="color: #6b7280; font-style: italic;">No trend context generated this week</p>'}
        </div>
    `;

    // Trending topics section
    if (this.trendsData.top_keywords && this.trendsData.top_keywords.length > 0) {
        html += '<h3 style="margin-bottom: 16px; color: #1f2937;">🔥 Trending Policy Topics</h3>';
        
        const significantTopics = this.trendsData.top_keywords.filter(topic => topic.count >= 3);
        const minorTopics = this.trendsData.top_keywords.filter(topic => topic.count < 3 && topic.count >= 2);
        
        if (significantTopics.length > 0) {
            significantTopics.forEach(topic => {
                html += `
                    <div class="trend-topic">
                        <div class="trend-header">
                            <div class="trend-keyword">${this.escapeHtml(topic.keyword)}</div>
                            <div class="trend-stats">
                                <span class="trend-stat">${topic.count} mentions</span>
                                <span class="trend-stat">High impact</span>
                            </div>
                        </div>
                        <div class="trend-description">
                            Key policy topic with significant coverage across multiple sources and days.
                        </div>
                    </div>
                `;
            });
        }
        
        if (minorTopics.length > 0) {
            html += '<h4 style="margin: 20px 0 12px; color: #6b7280; font-size: 14px;">Other Topics</h4>';
            const minorList = minorTopics.map(t => `${this.escapeHtml(t.keyword)} (${t.count})`).join(', ');
            html += `<div style="color: #6b7280; font-size: 14px; padding: 12px; background: #f9fafb; border-radius: 6px;">${minorList}</div>`;
        }
    } else {
        html += '<p style="color: #6b7280; padding: 20px;">No significant trending topics detected this week.</p>';
    }

    // Top sources section
    if (this.trendsData.top_sources && this.trendsData.top_sources.length > 0) {
        html += '<h3 style="margin: 24px 0 16px; color: #1f2937;">📰 Top News Sources</h3>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 8px;">';
        this.trendsData.top_sources.slice(0, 10).forEach(source => {
            html += `
                <span style="background: #f3f4f6; padding: 6px 12px; border-radius: 16px; font-size: 12px; color: #374151;">
                    ${this.escapeHtml(source.source)} (${source.count})
                </span>
            `;
        });
        html += '</div>';
    }

    // Week timeline section (if we have daily data)
    if (this.trendsData.daily_counts && Object.keys(this.trendsData.daily_counts).length > 1) {
        html += '<h3 style="margin: 24px 0 16px; color: #1f2937;">📅 Weekly Timeline</h3>';
        html += '<div style="display: flex; gap: 8px; flex-wrap: wrap;">';
        
        const sortedDays = Object.entries(this.trendsData.daily_counts)
            .sort(([a], [b]) => new Date(a) - new Date(b));
        
        sortedDays.forEach(([day, count]) => {
            try {
                const dayName = new Date(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                html += `
                    <div style="background: #f3f4f6; padding: 8px 12px; border-radius: 6px; text-align: center; min-width: 80px;">
                        <div style="font-size: 12px; color: #6b7280;">${dayName}</div>
                        <div style="font-size: 16px; font-weight: 600; color: #1f2937;">${count}</div>
                    </div>
                `;
            } catch (dateError) {
                console.warn('Invalid date in daily counts:', day);
            }
        });
        html += '</div>';
    }

    container.innerHTML = html;
};

// Initialize trends functionality when adminPanel exists
AdminPanel.prototype.initTrends = function() {
    // Add trendsData property to store trend analysis
    this.trendsData = null;
    
    // Log trends initialization
    this.addLog('info', 'Trends module loaded');
};

// Global functions for trends
function refreshTrends() {
    if (!window.adminPanel) {
        console.error('AdminPanel not available');
        return;
    }
    
    if (typeof window.adminPanel.loadTrends !== 'function') {
        console.error('loadTrends method not available');
        if (window.adminPanel.addLog) {
            window.adminPanel.addLog('error', 'Trends functionality not properly loaded');
        }
        return;
    }
    
    try {
        window.adminPanel.loadTrends();
    } catch (error) {
        console.error('Refresh trends failed:', error);
        if (window.adminPanel && window.adminPanel.addLog) {
            window.adminPanel.addLog('error', 'Trends refresh failed: ' + error.message);
        }
    }
}

// Initialize trends when adminPanel is ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait for adminPanel to be created and initialized
    const waitForAdminPanel = () => {
        if (window.adminPanel && window.adminPanel.addLog && typeof window.adminPanel.addLog === 'function') {
            // Initialize trends functionality
            if (typeof window.adminPanel.initTrends === 'function') {
                window.adminPanel.initTrends();
                console.log('✅ Trends module initialized');
            } else {
                console.warn('⚠️ AdminPanel found but initTrends method missing');
            }
        } else {
            // Keep waiting for adminPanel
            setTimeout(waitForAdminPanel, 200);
        }
    };
    
    // Start waiting
    setTimeout(waitForAdminPanel, 100);
});

// Export for debugging
window.refreshTrends = refreshTrends;

console.log('📊 Admin trends module loaded');
