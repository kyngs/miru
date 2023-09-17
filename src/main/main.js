/* eslint-disable no-new */
import { app, BrowserWindow, shell, ipcMain, dialog, MessageChannelMain } from 'electron'
import path from 'path'
import Discord from './discord.js'
import Protocol from './protocol.js'
import { development } from './util.js'

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow
let webtorrentWindow

function createWindow () {
  // Create the browser window.
  webtorrentWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  })
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: process.platform !== "win32", // Only hide the native frame on windows
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#17191c',
      symbolColor: '#eee',
      height: 28
    },
    backgroundColor: '#17191c',
    autoHideMenuBar: true,
    webPreferences: {
      enableBlinkFeatures: 'FontAccess, AudioVideoTracks',
      backgroundThrottling: false,
      preload: path.join(__dirname, '/preload.js')
    },
    icon: path.join(__dirname, '/logo.ico'),
    show: false
  })
  new Discord(mainWindow)
  new Protocol(mainWindow)
  mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['https://sneedex.moe/api/public/nyaa', atob('aHR0cDovL2FuaW1ldG9zaG8ub3JnL3N0b3JhZ2UvdG9ycmVudC8q'), atob('aHR0cHM6Ly9ueWFhLnNpLyo=')] }, ({ responseHeaders }, fn) => {
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    fn({ responseHeaders })
  })

  const torrentLoad = webtorrentWindow.loadURL(development ? 'http://localhost:5000/background.html' : `file://${path.join(__dirname, '/background.html')}`)
  mainWindow.loadURL(development ? 'http://localhost:5000/app.html' : `file://${path.join(__dirname, '/app.html')}`)

  if (development) {
    webtorrentWindow.webContents.openDevTools()
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    webtorrentWindow.webContents.postMessage('destroy', null)
    app.quit()
  })

  ipcMain.on('close', () => {
    mainWindow = null
    webtorrentWindow.webContents.postMessage('destroy', null)
    app.quit()
  })

  let crashcount = 0
  mainWindow.webContents.on('render-process-gone', (e, { reason }) => {
    if (reason === 'crashed') {
      if (++crashcount > 10) {
        dialog.showMessageBox({ message: 'Crashed too many times.', title: 'Miru', detail: 'App crashed too many times. For a fix visit https://github.com/ThaUnknown/miru/blob/master/docs/faq.md#miru-crashed-too-many-times', icon: '/renderer/public/logo.ico' }).then(() => {
          shell.openExternal('https://github.com/ThaUnknown/miru/blob/master/docs/faq.md#miru-crashed-too-many-times')
          app.quit()
        })
      } else {
        app.relaunch()
        app.quit()
      }
    }
  })

  // Emitted when the window is ready to be shown
  // This helps in showing the window gracefully.
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
  ipcMain.on('portRequest', async ({ sender }) => {
    const { port1, port2 } = new MessageChannelMain()
    await torrentLoad
    webtorrentWindow.webContents.postMessage('port', null, [port1])
    sender.postMessage('port', null, [port2])
  })
}

app.on('ready', createWindow)

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
