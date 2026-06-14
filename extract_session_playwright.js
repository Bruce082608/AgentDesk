// Extract jimeng sessionid from Edge browser using Playwright
const { chromium } = require('playwright');

async function extractSessionId() {
    // Use persistent context with Edge's user data directory
    const userDataDir = process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\User Data';
    
    console.log('Launching persistent Chromium context with Edge user data...');
    
    let browser;
    try {
        browser = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: 'msedge', // Use Edge channel if available, fallback to chromium
            args: ['--no-first-run', '--no-default-browser-check']
        });
    } catch (e) {
        console.log('Edge channel not available, trying Chromium with Edge data...');
        browser = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            args: ['--no-first-run', '--no-default-browser-check']
        });
    }
    
    // Get cookies for jimeng.jianying.com
    const cookies = await browser.cookies();
    const jimengCookies = cookies.filter(c => 
        c.domain.includes('jimeng') || c.domain.includes('jianying')
    );
    
    console.log(`Found ${jimengCookies.length} cookies for jimeng/jianying:`);
    for (const c of jimengCookies) {
        console.log(`  ${c.name}: ${c.value.substring(0, 50)}... (domain: ${c.domain})`);
    }
    
    // Find sessionid
    const sessionCookie = jimengCookies.find(c => c.name === 'sessionid');
    if (sessionCookie) {
        console.log(`\n✅ SessionID: ${sessionCookie.value}`);
        return sessionCookie.value;
    } else {
        console.log('\n❌ No sessionid cookie found');
        return null;
    }
    
    await browser.close();
}

extractSessionId().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
