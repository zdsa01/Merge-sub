// 可带参数订阅或访问：workers域名或绑定的域名/sub?CFIP=优选ip或优选域名&CFPORT=优选ip或优选域名对应的端口
// 例如：workers域名或绑定的域名/sub?CFIP=47.75.222.188&CFPORT=7890

//  请求api自动添加节点订阅或单节点方式
// curl -X POST https://workers域名或绑定的域名/add-subscription \
//     -H "Content-Type: application/json" \
//     -d '{"sub": "订阅链接"}'

// curl -X POST https://workers域名或绑定的域名/add-nodes \
//     -H "Content-Type: application/json" \
//     -d '{"nodes": ["vless://","vmess://","tuic://","hy2://"]}'

// Cloudflare API 配置（如需动态更新代码，请填写真实值；仅用订阅归总可不填）
const CLOUDFLARE_API_TOKEN = '';    // 替换为你的 Cloudflare API Token
const CLOUDFLARE_ACCOUNT_ID = '';   // 替换为你的 Cloudflare Account ID
const CLOUDFLARE_SCRIPT_NAME = 'sub';   // 替换为创建 Workers 时的名称

// 安全配置
const ALLOWED_IPS = [];         // 允许IP访问，默认开放所有IP,若限制IP,将影响订阅上传功能,若只使用订阅归总功能,可限制IP
const RATE_LIMIT = 3;           // 每分钟最多 3 次请求

// 订阅配置
let CFIP = "www.visa.com.tw";  // 优选 IP 或优选域名
let CFPORT = "443";            // 优选 IP 或域名对应的端口
const SUB_PATH = '/sub';       // 订阅路径,可更换更复杂的请求路径

// 订阅链接（请替换为真实可用的订阅地址，不要使用示例）
// 示例：
// let subscriptions = [
//   "https://example.com/your-sub1",
//   "https://example.com/your-sub2"
// ];
let subscriptions = [
];

// 单独节点（请替换为真实节点，格式示例见下，添加前请清空）
// 示例格式：
// "vless://uuid@host:port?encryption=none&security=tls&type=ws&host=xxx&path=%2F",
// "vmess://base64...",
// "trojan://password@host:port?security=tls&type=ws&host=xxx&path=%2F",
// "hysteria2://uuid@host:port/?sni=xxx",
// "tuic://uuid:password@host:port"
let nodes = [
];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const nodeArray = nodes;
const rateLimitMap = new Map();

// 获取原代码（需要有效的 Cloudflare API 配置）
async function getOriginalCode() {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${CLOUDFLARE_SCRIPT_NAME}`,
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/javascript'
        }
      }
    );
    if (response.ok) {
      return await response.text();
    }
  } catch (e) {
    console.error('getOriginalCode error:', e);
  }
  return null;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const clientIP = request.headers.get('CF-Connecting-IP') || '';

  // 简单限流
  if (RATE_LIMIT > 0) {
    const now = Date.now();
    const key = clientIP || 'global';
    let record = rateLimitMap.get(key) || { count: 0, reset: now + 60000 };
    if (now > record.reset) {
      record = { count: 0, reset: now + 60000 };
    }
    record.count++;
    rateLimitMap.set(key, record);
    if (record.count > RATE_LIMIT) {
      return new Response('Too Many Requests', { status: 429 });
    }
  }

  // IP 白名单（空数组表示不限制）
  if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(clientIP)) {
    return new Response('Forbidden', { status: 403 });
  }

  // 从查询参数中获取 CFIP 和 CFPORT
  const queryCFIP = url.searchParams.get('CFIP');
  const queryCFPORT = url.searchParams.get('CFPORT');
  if (queryCFIP && queryCFPORT) {
    CFIP = queryCFIP;
    CFPORT = queryCFPORT;
  }

  if (url.pathname === SUB_PATH) {
    const mergedSubscription = await generateMergedSubscription();
    const base64Content = btoa(unescape(encodeURIComponent(mergedSubscription)));
    return new Response(base64Content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  if (url.pathname === '/add-subscription' && request.method === 'POST') {
    try {
      const body = await request.json();
      const sub = body.sub || body.subscription;
      if (sub) {
        if (Array.isArray(sub)) {
          subscriptions.push(...sub.filter(s => s && s.startsWith('http')));
        } else if (typeof sub === 'string') {
          sub.split('\n').map(s => s.trim()).filter(s => s.startsWith('http')).forEach(s => subscriptions.push(s));
        }
      }
      return new Response(JSON.stringify({ success: true, subscriptions }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400 });
    }
  }

  if (url.pathname === '/add-nodes' && request.method === 'POST') {
    try {
      const body = await request.json();
      const newNodes = body.nodes;
      if (Array.isArray(newNodes)) {
        nodeArray.push(...newNodes.filter(n => n));
      } else if (typeof newNodes === 'string') {
        newNodes.split('\n').map(n => n.trim()).filter(n => n).forEach(n => nodeArray.push(n));
      }
      return new Response(JSON.stringify({ success: true, nodes: nodeArray }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400 });
    }
  }

  return new Response('Merge-sub Worker is running. Access /sub for subscription.', { status: 200 });
}

async function fetchSubscriptionContent(subscription) {
  if (!subscription || (!subscription.startsWith('http://') && !subscription.startsWith('https://'))) {
    return null;
  }
  try {
    const response = await fetch(subscription, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Merge-sub/1.0)' },
      cf: { cacheTtl: 60 }
    });
    return response.ok ? await response.text() : null;
  } catch (e) {
    console.error('Fetch failed:', subscription, e);
    return null;
  }
}

function decodeBase64Content(base64Content) {
  try {
    return atob(base64Content.trim());
  } catch (e) {
    return base64Content;
  }
}

function replaceAddressAndPort(content) {
  if (!CFIP || !CFPORT) return content;

  return content.split('\n').map(line => {
    line = line.trim();
    if (!line) return line;

    if (line.startsWith('vmess://')) {
      try {
        const base64Part = line.substring(8);
        const decoded = decodeBase64Content(base64Part);
        const obj = JSON.parse(decoded);
        if ((obj.net === 'ws' || obj.net === 'xhttp') && obj.tls === 'tls') {
          if (!obj.host || obj.host !== obj.add) {
            obj.add = CFIP;
            obj.port = parseInt(CFPORT, 10);
          }
        }
        return 'vmess://' + btoa(JSON.stringify(obj));
      } catch (e) {
        return line;
      }
    } else if (line.startsWith('vless://') || line.startsWith('trojan://')) {
      if ((line.includes('type=ws') || line.includes('type=xhttp')) && line.includes('security=tls')) {
        return line.replace(/@([\w.-]+):(\d+)/, `@${CFIP}:${CFPORT}`);
      }
    }
    return line;
  }).join('\n');
}

async function generateMergedSubscription() {
  const nodesContent = nodeArray.join('\n');
  const promises = subscriptions.map(async (subscription) => {
    const content = await fetchSubscriptionContent(subscription);
    if (!content) return null;
    let decoded;
    try {
      decoded = decodeBase64Content(content);
    } catch {
      decoded = content;
    }
    return replaceAddressAndPort(decoded);
  });

  const results = await Promise.all(promises);
  const parts = [nodesContent, ...results.filter(c => c && c.trim())];
  return parts.join('\n');
}
