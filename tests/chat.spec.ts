import { expect, test, type Page } from '@playwright/test'
import { SUBPATH_CASES } from './subpaths'

const PASSWORD = 'secret123'

async function signUp(page: Page, username: string, url = './') {
  await page.goto(url)
  await expect(page.locator('.auth__title')).toHaveText('Chatter')
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create my account' }).click()
  await expect(page.locator('.sidebar__brand-text span')).toHaveText(`@${username}`)
}

async function signIn(page: Page, username: string) {
  await expect(page.locator('.auth__title')).toBeVisible()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Records anything that would mean the deployment is broken. */
function collectFailures(page: Page, label: string, failures: string[]) {
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${label} ${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown'
    // Aborted navigations are normal; anything else is a real failure.
    if (!reason.includes('ERR_ABORTED')) failures.push(`${label} FAILED ${request.url()} ${reason}`)
  })
  page.on('pageerror', (error) => failures.push(`${label} pageerror ${error.message}`))
  return failures
}

// The same suite runs under every repo name GitHub Pages might use.
for (const subpath of SUBPATH_CASES) {
  const origin = `http://127.0.0.1:${subpath.port}`
  const baseUrl = `${origin}/${subpath.name}/`

  test.describe(`app hosted at /${subpath.name}/`, () => {
    test.use({ baseURL: baseUrl })

    test('two accounts exchange contact and chat live', async ({ context, page: alice }) => {
      const pageErrors: string[] = []
      const watch = (page: Page, label: string) => {
        page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`))
      }
      watch(alice, 'alice')

      // 1. Two accounts. Same origin (so they share the message store) but
      //    separate tabs, so each has its own signed-in session.
      await signUp(alice, 'alice_w')
      await expect(alice.locator('.chat-list__empty')).toContainText('No chats yet')

      const bob = await context.newPage()
      watch(bob, 'bob')
      await signUp(bob, 'bob_q')

      // 2. Contact exchange #1: find the other person by username.
      await alice.locator('.search input').fill('bob_q')
      await alice.locator('.chat-item', { hasText: 'Chat with @bob_q' }).click()
      await expect(alice.locator('.chat-pane__header .peer-name')).toHaveText('bob_q')

      // 3. Message lands on the other side with no reload.
      await alice.locator('.composer input').fill('Hello Bob, this is live')
      await alice.locator('.composer input').press('Enter')
      await expect(alice.locator('.msg-row--out .bubble__text')).toHaveText(
        'Hello Bob, this is live',
      )

      const bobChat = bob.locator('.chat-item', { hasText: 'alice_w' })
      await expect(bobChat).toBeVisible()
      await expect(bobChat.locator('.chat-item__preview')).toContainText('Hello Bob, this is live')
      await expect(bobChat.locator('.badge')).toHaveText('1')

      // 4. Sent tick only — the recipient has not opened the chat yet.
      await expect(alice.locator('.msg-row--out .ticks')).toHaveCount(1)
      await expect(alice.locator('.ticks--read')).toHaveCount(0)

      // 5. Recipient opens the chat: badge clears, sender's tick becomes "read".
      await bobChat.click()
      await expect(bob.locator('.msg-row:not(.msg-row--out) .bubble__text')).toHaveText(
        'Hello Bob, this is live',
      )
      await expect(bob.locator('.badge')).toHaveCount(0)
      await expect(alice.locator('.msg-row--out .ticks--read')).toHaveCount(1)

      // 6. Reply travels the other direction live.
      await bob.locator('.composer input').fill('Got it, Alice!')
      await bob.locator('.composer input').press('Enter')
      await expect(alice.locator('.msg-row:not(.msg-row--out) .bubble__text')).toHaveText(
        'Got it, Alice!',
      )

      // 7. Typing indicator while the other side is composing.
      await alice.locator('.composer input').fill('typing right now')
      await expect(bob.locator('.peer-sub')).toContainText('is typing')
      await alice.locator('.composer input').press('Enter')
      await expect(bob.locator('.msg-row:not(.msg-row--out) .bubble__text').last()).toHaveText(
        'typing right now',
      )

      // 8. Contact exchange #2: the QR payload, opened the way a scanner would
      //    (fresh tab, signed out) → sign in → the chat opens by itself.
      await alice.locator('.icon-btn[title="My QR code"]').click()
      await expect(alice.locator('.qr-frame img')).toBeVisible()
      const qrLink = (await alice.locator('.link-box code').innerText()).trim()
      expect(qrLink).toMatch(/#\/u\/alice_w$/)
      await alice.locator('.modal__header .icon-btn[title="Close"]').click()

      const scanned = await context.newPage()
      watch(scanned, 'scanned')
      await scanned.goto(qrLink)
      await signIn(scanned, 'bob_q')
      await expect(scanned.locator('.chat-pane__header .peer-name')).toHaveText('alice_w')
      await expect(
        scanned.locator('.msg-row:not(.msg-row--out) .bubble__text').first(),
      ).toContainText('Hello Bob')
      // The deep link opens the existing conversation instead of creating a second
      // one (the sidebar's "Me" row is not a conversation with alice_w).
      const aliceRows = scanned
        .locator('.chat-item')
        .filter({ has: scanned.locator('.chat-item__name', { hasText: 'alice_w' }) })
      await expect(aliceRows).toHaveCount(1)

      expect(pageErrors).toEqual([])
    })

    test('chat with myself to try the app alone', async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))

      await signUp(page, 'solo_user')

      // The sidebar offers a one-tap "Me" chat until that chat exists.
      await page.locator('.chat-item', { hasText: 'Chat with yourself' }).click()
      await expect(page.locator('.chat-pane__header .peer-name')).toHaveText('You')
      await expect(page.locator('.chat-pane__header .peer-sub')).toHaveText('Notes to self')

      await page.locator('.composer input').fill('note to self: ship it')
      await page.locator('.composer input').press('Enter')
      await expect(page.locator('.msg-row--out .bubble__text')).toHaveText(
        'note to self: ship it',
      )
      // Your own messages are never unread.
      await expect(page.locator('.badge')).toHaveCount(0)

      // It survives a reload and is not duplicated.
      await page.reload()
      await expect(page.locator('.chat-item')).toHaveCount(1)
      await expect(page.locator('.chat-item', { hasText: 'note to self' })).toBeVisible()
      await expect(page.locator('.chat-item', { hasText: 'Chat with yourself' })).toHaveCount(0)
      await page.locator('.chat-item', { hasText: 'note to self' }).click()
      await expect(page.locator('.msg-row--out .bubble__text')).toHaveText(
        'note to self: ship it',
      )

      expect(pageErrors).toEqual([])
    })

    test('serves every asset, handles QR deep links and keeps the session', async ({
      context,
      page,
    }) => {
      const failures: string[] = []
      collectFailures(page, 'page', failures)

      // Every asset the built index.html references must exist under this subpath.
      const indexResponse = await page.request.get(baseUrl)
      expect(indexResponse.status()).toBe(200)
      const html = await indexResponse.text()
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
      expect(refs.length).toBeGreaterThan(0)
      for (const ref of refs) {
        const assetUrl = new URL(ref, baseUrl).toString()
        const asset = await page.request.get(assetUrl)
        expect(asset.status(), `asset ${ref} → ${assetUrl}`).toBe(200)
      }
      // The favicon is the one image asset the page itself loads.
      expect(refs.some((ref) => ref.includes('favicon.svg')), 'favicon referenced').toBe(true)

      await page.goto('./')
      await expect(page.locator('.auth__title')).toHaveText('Chatter')
      // The stylesheet really came from this subpath.
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        'rgb(11, 20, 26)',
      )

      await signUp(page, 'alice_w')

      // The lazily imported scanner chunk must resolve under this subpath too.
      await page.locator('.icon-btn[title="Scan a QR code"]').click()
      await page.waitForTimeout(2500)
      await page.locator('.modal__header .icon-btn[title="Close"]').click()

      // QR payload points at this subpath.
      await page.locator('.icon-btn[title="My QR code"]').click()
      const linkBox = page.locator('.link-box code')
      await expect(linkBox).toContainText(`/${subpath.name}/#/u/alice_w`)
      const qrLink = (await linkBox.innerText()).trim()
      await page.locator('.modal__header .icon-btn[title="Close"]').click()

      // A second account, then a deep link opened in a fresh tab.
      const bob = await context.newPage()
      collectFailures(bob, 'bob', failures)
      await signUp(bob, 'bob_q')

      const scanned = await context.newPage()
      collectFailures(scanned, 'scanned', failures)
      await scanned.goto(qrLink)
      await signIn(scanned, 'bob_q')
      await expect(scanned.locator('.chat-pane__header .peer-name')).toHaveText('alice_w')

      // A signed-in user reopening the subpath lands back on the chat list.
      await page.reload()
      await expect(page.locator('.sidebar__brand-text span')).toHaveText('@alice_w')
      await expect(page.locator('.chat-item', { hasText: 'bob_q' })).toBeVisible()

      expect(failures).toEqual([])
    })
  })
}
