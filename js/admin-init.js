// admin-init.js - Global functions and initialization

// Global UI functions
function showTab(tabName) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    // Show selected panel and tab
    document.getElementById(`${tabName}-panel`).classList.add('active');
    event.target.classList.add('active');
}

function filterArticles(filter) {
    // Update button states
    document.querySelectorAll('.article-filter-tabs button').forEach(btn => {
        btn.classList.add('btn-secondary');
    });
    const filterBtn = document.getElementById(`filter-${filter}`);
    if (filterBtn) {
        filterBtn.classList.remove('btn-secondary');
    }
    
    adminPanel.renderArticles(filter);
}

// Main action functions
async function triggerUpdate() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ Updating...';
    
    adminPanel.addLog('info', 'Manual update triggered');
    
    try {
        const response = await fetch(`${adminPanel.API_BASE}/api/admin?action=regenerate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminPanel.adminKey}`
            },
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        if (data.success) {
            adminPanel.addLog('success', `Update completed - ${data.processing.articles_processed} articles processed (${data.processing.success_rate}% success rate)`);
            await adminPanel.loadData();
            adminPanel.updateStats();
        } else {
            adminPanel.addLog('error', 'Update failed: ' + data.error);
        }
    } catch (error) {
        adminPanel.addLog('error', 'Update request failed: ' + error.message);
        // Fallback to manual trigger endpoint
        try {
            const fallbackResponse = await fetch(`${adminPanel.API_BASE}/api/manual-trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trigger_key: 'force-update-2025' })
            });
            const fallbackData = await fallbackResponse.json();
            if (fallbackData.success) {
                adminPanel.addLog('success', 'Fallback update successful');
                await adminPanel.loadData();
                adminPanel.updateStats();
            }
        } catch (fallbackError) {
            adminPanel.addLog('error', 'Fallback also failed: ' + fallbackError.message);
        }
    }
    
    btn.disabled = false;
    btn.textContent = '🚀 Force Update Today';
}

async function refreshData() {
    adminPanel.addLog('info', 'Refreshing data...');
    await adminPanel.loadData();
    adminPanel.updateStats();
}

function clearToday() {
    if (confirm('Clear today\'s edition? This cannot be undone.')) {
        try {
            fetch(`${adminPanel.API_BASE}/api/admin?action=clear-today`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminPanel.adminKey}`
                }
            }).then(() => {
                adminPanel.articles = [];
                adminPanel.renderArticles();
                adminPanel.updateStats();
                adminPanel.addLog('success', 'Today\'s edition cleared');
            });
        } catch (error) {
            adminPanel.addLog('error', 'Failed to clear edition: ' + error.message);
        }
    }
}

// Preview functions
function togglePreviewMode(mode) {
    const frame = document.getElementById('preview-frame');
    const container = document.getElementById('preview-container');
    
    if (!frame || !container) return;
    
    if (mode === 'mobile') {
        frame.style.width = '375px';
        frame.style.margin = '0 auto';
        container.style.textAlign = 'center';
        adminPanel.addLog('info', 'Switched to mobile preview mode');
    } else {
        frame.style.width = '100%';
        frame.style.margin = '0';
        container.style.textAlign = 'left';
        adminPanel.addLog('info', 'Switched to desktop preview mode');
    }
}

function refreshPreview() {
    const frame = document.getElementById('preview-frame');
    if (frame) {
        frame.src = adminPanel.API_BASE + '?preview=true&t=' + Date.now();
        adminPanel.addLog('info', 'Preview refreshed');
    }
}

// Utility functions
function refreshLogs() {
    adminPanel.addLog('info', 'Logs refreshed');
}

function clearLogs() {
    const logsContainer = document.getElementById('logs-container');
    if (logsContainer) {
        logsContainer.innerHTML = '';
        adminPanel.addLog('info', 'Logs cleared');
    }
}

function saveSettings() {
    adminPanel.saveSettings();
}

function resetSettings() {
    adminPanel.resetSettings();
}

function closeModal() {
    adminPanel.closeModal();
}

// Initialize admin panel
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
    adminPanel.init().then(() => {
        adminPanel.populateSettingsForm();
        
        // Initialize preview
        refreshPreview();
        
        // Load saved prompts
        const savedSystemPrompt = localStorage.getItem('hdta-custom-system-prompt');
        const savedUserPrompt = localStorage.getItem('hdta-custom-user-prompt');
        
        const systemPromptEditor = document.getElementById('prompt-editor');
        const userPromptEditor = document.getElementById('user-prompt-editor');
        
        if (savedSystemPrompt && systemPromptEditor) {
            systemPromptEditor.value = savedSystemPrompt;
        }
        if (savedUserPrompt && userPromptEditor) {
            userPromptEditor.value = savedUserPrompt;
        }
        
        adminPanel.addLog('success', 'Admin panel initialized successfully');
    }).catch(error => {
        console.error('Failed to initialize admin panel:', error);
        if (adminPanel) {
            adminPanel.addLog('error', 'Failed to initialize: ' + error.message);
        }
    });
});

// Bind modal saveAnalysis globally for the modal button
window.saveAnalysis = function() { 
    if (adminPanel && adminPanel.saveAnalysis) {
        adminPanel.saveAnalysis(); 
    }
};

// Error handling
window.addEventListener('error', function(e) {
    if (adminPanel) {
        adminPanel.addLog('error', `JavaScript error: ${e.message}`);
    }
    console.error('Global error:', e);
});

// Export for debugging
window.adminPanel = adminPanel;
