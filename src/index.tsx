import { Hono } from 'hono'
import { cors } from 'hono/cors'
import api from './api/routes'
import type { Bindings } from './api/helpers'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.route('/api/v1', api)

app.get('/api/health', (c) => c.json({ ok: true, service: 'Legal Metrology Compliance Checker' }))

// SPA shell — all UI logic lives in /static/app.js
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Legal Metrology Compliance Checker — LMPC Rules, 2011</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="/static/style.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: { extend: { colors: {
        gov: { 50:'#eef4ff',100:'#dbe6fe',600:'#1d4ed8',700:'#1e40af',800:'#1e3a8a',900:'#172554' },
        saffron: '#FF9933', indiagreen: '#138808'
      }}}}
  </script>
</head>
<body class="bg-slate-100 min-h-screen">
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
