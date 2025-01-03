import { setTimeout } from 'node:timers/promises'

globalThis[Symbol.for('plt.children.itc')].handle('start', async port => {
  {
    const response = await fetch(`http://127.0.0.1:${port}`)

    console.log(response.status, await response.json())
  }

  {
    const response = await fetch('http://service.plt.local/foo')

    console.log(response.status, await response.json())
  }

  {
    const response = await fetch('http://service.plt.local/bar')

    console.log(response.status, await response.json())
  }

  try {
    await fetch('http://service.plt.local/error')
  } catch (e) {
    console.error(e.cause.message)
  }

  // GitHub CI is slow
  await setTimeout(3000)
  return true
})

globalThis[Symbol.for('plt.children.itc')].notify('ready')
