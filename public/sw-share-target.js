self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname !== '/' || event.request.method !== 'POST') return

  event.respondWith(
    (async () => {
      const formData = await event.request.formData()
      const files = formData.getAll('files')
      const title = formData.get('title') ?? ''
      const text = formData.get('text') ?? ''
      const sharedUrl = formData.get('url') ?? ''

      const payload = {
        type: 'share-target',
        files,
        title,
        text,
        url: sharedUrl,
      }

      // Redirect first, then postMessage after client loads
      const response = Response.redirect(self.location.origin + '/', 303)

      event.waitUntil(
        (async () => {
          // Wait for the client to be ready after redirect
          await new Promise(resolve => setTimeout(resolve, 1000))
          const allClients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })
          for (const client of allClients) {
            client.postMessage(payload)
          }
        })()
      )

      return response
    })()
  )
})