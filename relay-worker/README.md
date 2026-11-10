# Viperstrike relay (Cloudflare)

Invites connect two PCs directly when they can. When a network blocks that, Cloudflare's TURN relay
carries the layout instead. This Worker hands Viperstrike short-lived relay passwords, so the secret
TURN key never goes inside the app.

Cost: Cloudflare's docs list a free tier of 1,000 GB a month for TURN, then $0.05 per GB. Layout
traffic is a few MB an hour, and only relayed connections count.

Menu names below can differ slightly in Cloudflare's dashboard.

## 1. Make a TURN key
1. Sign in (or sign up free) at https://dash.cloudflare.com.
2. Open **Realtime** (sometimes called **Calls**) and then **TURN Server**, and create a TURN key.
   Name it `viperstrike`.
3. Copy the **Turn Token ID** and the **API Token** it shows. The token is only shown once.

## 2. Make the Worker
1. Go to **Workers & Pages**, **Create**, start from the **Hello World** Worker.
2. Name it `viperstrike-relay` and deploy it.
3. Click **Edit code**, replace everything with the contents of `worker.js` from this folder, and deploy.
4. In the Worker's **Settings**, **Variables and Secrets**, add two variables of type **Secret**:
   - `TURN_KEY_ID`: the Turn Token ID
   - `TURN_KEY_API_TOKEN`: the API Token
5. Open `https://viperstrike-relay.<your-subdomain>.workers.dev/ice` in a browser. You should see
   `{"iceServers":[...]}` with `turn:turn.cloudflare.com` addresses. An `error` there says what's wrong.

## 3. Build it into Viperstrike
Create `build/relay.json` in the Viperstrike folder (copy `build/relay.example.json`):

```json
{ "credentialsUrl": "https://viperstrike-relay.<your-subdomain>.workers.dev/ice" }
```

Every build from then on uses the relay. Nobody has to set anything up in the app.

## If something goes wrong
- To cut off access, delete the TURN key in Cloudflare and make a new one. Then update the
  two secrets. Installed copies keep working, because they ask the Worker each time.
- The Worker link is public. Anyone who finds it can get relay passwords, which use your
  allowance. Cloudflare's dashboard shows usage, and you can set a billing alert there.
