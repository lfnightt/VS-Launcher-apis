// API Documentation App
document.addEventListener('DOMContentLoaded', () => {
    // Set current year
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    // Set base URL
    const baseUrl = window.location.origin;
    document.getElementById('base-url').textContent = baseUrl;
    
    // Load endpoints
    loadEndpoints();
});

// Load endpoints from API
async function loadEndpoints() {
    try {
        const response = await fetch('/api');
        const data = await response.json();
        
        const endpointsList = document.getElementById('endpoints-list');
        endpointsList.innerHTML = '';
        
        data.endpoints.forEach(endpoint => {
            const card = createEndpointCard(endpoint);
            endpointsList.appendChild(card);
        });
    } catch (error) {
        console.error('Failed to load endpoints:', error);
        // Fallback to static content
        loadStaticEndpoints();
    }
}

// Create endpoint card
function createEndpointCard(endpoint) {
    const card = document.createElement('div');
    card.className = 'endpoint-card';
    
    const params = endpoint.parameters ? endpoint.parameters.map(p => 
        `<span style="color: #eab308;">${p.name}</span>: ${p.type}${p.required ? ' (required)' : ''}`
    ).join('<br>') : '';
    
    card.innerHTML = `
        <div class="endpoint-header">
            <span class="endpoint-method">${endpoint.method}</span>
            <span class="endpoint-path">${endpoint.path}</span>
        </div>
        <p class="endpoint-desc">${endpoint.description}</p>
        ${params ? `<div style="margin-bottom: 12px; font-size: 13px; color: #a0a0a0;">${params}</div>` : ''}
        <div class="endpoint-example">
            <span>Example:</span>
            <code>${endpoint.example}</code>
        </div>
    `;
    
    return card;
}

// Load static endpoints as fallback
function loadStaticEndpoints() {
    const endpointsList = document.getElementById('endpoints-list');
    const endpoints = [
        {
            method: 'GET',
            path: '/api/servers',
            description: 'Get list of game servers',
            example: '/api/servers?platform=gta5'
        },
        {
            method: 'GET',
            path: '/api/servers/:platform',
            description: 'Get servers for specific platform',
            example: '/api/servers/gta5'
        },
        {
            method: 'GET',
            path: '/api/servers/stats/summary',
            description: 'Get server statistics summary',
            example: '/api/servers/stats/summary'
        },
        {
            method: 'GET',
            path: '/api/health',
            description: 'Health check endpoint',
            example: '/api/health'
        }
    ];
    
    endpointsList.innerHTML = '';
    endpoints.forEach(endpoint => {
        const card = createEndpointCard(endpoint);
        endpointsList.appendChild(card);
    });
}

// Test API endpoint
async function testAPI() {
    const select = document.getElementById('endpoint-select');
    const endpoint = select.value;
    const resultBody = document.getElementById('result-body');
    const resultStatus = document.getElementById('result-status');
    const resultTime = document.getElementById('result-time');
    
    resultStatus.textContent = 'Loading...';
    resultStatus.style.color = '#eab308';
    resultBody.innerHTML = '<code>// Sending request...</code>';
    
    const startTime = performance.now();
    
    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        
        resultStatus.textContent = `${response.status} ${response.statusText}`;
        resultStatus.style.color = response.ok ? '#22c55e' : '#ef4444';
        resultTime.textContent = `${duration}ms`;
        
        resultBody.innerHTML = `<code>${syntaxHighlight(JSON.stringify(data, null, 2))}</code>`;
    } catch (error) {
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        
        resultStatus.textContent = 'Error';
        resultStatus.style.color = '#ef4444';
        resultTime.textContent = `${duration}ms`;
        resultBody.innerHTML = `<code style="color: #ef4444;">${error.message}</code>`;
    }
}

// Syntax highlighting for JSON
function syntaxHighlight(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'key';
            } else {
                cls = 'string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

// Copy to clipboard
function copyToClipboard(button) {
    const codeBlock = button.closest('.code-block');
    const code = codeBlock.querySelector('code');
    
    navigator.clipboard.writeText(code.textContent).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.style.color = '#22c55e';
        
        setTimeout(() => {
            button.textContent = originalText;
            button.style.color = '';
        }, 2000);
    });
}
