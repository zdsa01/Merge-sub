// 订阅：workers域名/sub  sub路径可定义
// 带参数订阅：workers域名/sub?CFIP=优选ip&CFPORT=优选ip端口
// 例如：https://test.abc.worker.dev/sub?CFIP=47.75.222.188&CFPORT=7890

let CFIP = "www.visa.com.tw";  // 优选ip或优选域名
let CFPORT = "443";            // 优选ip或有序域名对应的端口
const SUB_PATH = '/sub';       // 访问路径

// 添加多个订阅链接（请替换为真实可用的订阅地址，不要使用示例）
// 示例格式：
// const subscriptions = [
//   'https://example.com/your-sub1',
//   'https://example.com/your-sub2'
// ];
const subscriptions = [
  // 在此添加你的订阅链接，每行一个，最后一个不要逗号
];

// 支持添加单条或多条自建节点，可以为空
// 请替换为真实节点，以下为格式示例（添加前请删除注释中的示例）
const nodes = `
`;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const nodeArray = nodes.trim().split('\n').filter(node => node); 

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 从查询参数中获取 CFIP 和 CFPORT
  const queryCFIP = url.searchParams.get('CFIP');
  const queryCFPORT = url.searchParams.get('CFPORT');

  if (queryCFIP && queryCFPORT) {
      CFIP = queryCFIP;
      CFPORT = queryCFPORT;
      console.log(`CFIP and CFPORT updated to ${CFIP}:${CFPORT}`);
  }

  if (url.pathname === SUB_PATH) {
      const mergedSubscription = await generateMergedSubscription();
      const base64Content = btoa(mergedSubscription);
      return new Response(base64Content, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  } else if (url.pathname === '/add-subscription' && request.method === 'POST') {
      const newSubscription = await request.json();
      addSubscription(newSubscription.subscription);
      return new Response('Subscription added successfully', { status: 200 });
  } else if (url.pathname === '/add-nodes' && request.method === 'POST') {  
      const newNodes = await request.json();
      addMultipleNodes(newNodes.nodes); 
      return new Response('Nodes added successfully', { status: 200 });
  }

  return new Response('Hello world!', { status: 200 });
}

function addSubscription(subscription) {
  if (subscription) subscriptions.push(subscription);
}

function addMultipleNodes(newNodes) {
  if (Array.isArray(newNodes)) {
    nodeArray.push(...newNodes.filter(n => n));
  }
}

async function fetchSubscriptionContent(subscription) {
  if (!subscription || (!subscription.startsWith('http://') && !subscription.startsWith('https://'))) {
    return null; 
  }
  try {
    const response = await fetch(subscription, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return response.ok ? await response.text() : null;
  } catch (e) {
    console.error('Fetch subscription failed:', e);
    return null;
  }
}

function decodeBase64Content(base64Content) {
  try {
    return atob(base64Content.trim());
  } catch (e) {
    // 可能不是 base64，直接返回原文
    return base64Content;
  }
}

function replaceAddressAndPort(content) {
  if (!CFIP || !CFPORT) {
      return content;
  }

  return content.split('\n').map(line => {
      line = line.trim();
      if (!line) return line;
      if (line.startsWith('vmess://')) {
          try {
            const base64Part = line.substring(8);
            const decodedVmess = decodeBase64Content(base64Part);
            const vmessObj = JSON.parse(decodedVmess);
            if ((vmessObj.net === 'ws' || vmessObj.net === 'xhttp') && vmessObj.tls === 'tls') {
              if (!vmessObj.host || vmessObj.host !== vmessObj.add) {
                vmessObj.add = CFIP;
                vmessObj.port = parseInt(CFPORT, 10);
              }
            }
            const updatedVmess = btoa(JSON.stringify(vmessObj));
            return `vmess://${updatedVmess}`;
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
      const subscriptionContent = await fetchSubscriptionContent(subscription);
      if (subscriptionContent) {
          // 尝试 base64 解码，失败则使用原文
          let decodedContent;
          try {
            decodedContent = decodeBase64Content(subscriptionContent);
          } catch {
            decodedContent = subscriptionContent;
          }
          const updatedContent = replaceAddressAndPort(decodedContent);
          return updatedContent;
      }
      return null;
  });

  const mergedContentArray = await Promise.all(promises);
  mergedContentArray.unshift(nodesContent);
  return mergedContentArray.filter(content => content !== null && content.trim()).join('\n');
}
