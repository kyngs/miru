import { anitomyscript } from '../anime.js'
import { fastPrettyBytes, sleep } from '../util.js'
import { exclusions } from '../rss.js'
import { settings } from '@/modules/settings.js'
import { anilistClient } from '../anilist.js'
import { client } from '@/modules/torrent.js'
import mapBestSneedexReleases from './sneedex.js'
import getSeedexBests from './seadex.js'

export default async function ({ media, episode }) {
  const json = await getAniDBFromAL(media)
  if (typeof json !== 'object') {
    const bests = await getSeedexBests(media)
    if (!bests.length) throw new Error(json || 'No mapping found.')
    return bests
  }

  const movie = isMovie(media) // don't query movies with qualities, to allow 4k

  const aniDBEpisode = await getAniDBEpisodeFromAL({ media, episode }, json)
  let entries = await getToshoEntriesForMedia(media, aniDBEpisode, json, !movie && settings.value.rssQuality)
  if (!entries.length && !movie) entries = await getToshoEntriesForMedia(media, aniDBEpisode, json)
  if (!entries?.length) throw new Error('No entries found.')

  const deduped = dedupeEntries(entries)
  const parseObjects = await anitomyscript(deduped.map(({ title }) => title))
  for (const i in parseObjects) deduped[i].parseObject = parseObjects[i]

  const withBests = dedupeEntries([...await getSeedexBests(media), ...mapBestSneedexReleases(deduped)])

  return updatePeerCounts(withBests)
}

async function updatePeerCounts (entries) {
  const id = crypto.randomUUID()

  const updated = await Promise.race([
    new Promise(resolve => {
      function check ({ detail }) {
        if (detail.id !== id) return
        client.removeListener('scrape', check)
        resolve(detail.result)
        console.log(detail)
      }
      client.on('scrape', check)
      client.send('scrape', { id, infoHashes: entries.map(({ hash }) => hash) })
    }),
    sleep(5000)
  ])

  for (const { hash, complete, downloaded, incomplete } of updated || []) {
    const found = entries.find(mapped => mapped.hash === hash)
    found.downloads = downloaded
    found.leechers = incomplete
    found.seeders = complete
  }
  return entries
}

async function getAniDBFromAL (media) {
  console.log('getting AniDB ID from AL')
  const mappingsResponse = await fetch('https://api.ani.zip/mappings?anilist_id=' + media.id)
  const json = await mappingsResponse.json()
  if (json.mappings?.anidb_id) return json

  console.log('failed getting AniDB ID, checking via parent')

  const parentID = getParentForSpecial(media)
  if (!parentID) return

  console.log('found via parent')

  const parentResponse = await fetch('https://api.ani.zip/mappings?anilist_id=' + parentID)
  return parentResponse.json()
}

function getParentForSpecial (media) {
  if (!['SPECIAL', 'OVA', 'ONA'].some(format => media.format === format)) return false
  const animeRelations = media.relations.edges.filter(({ node }) => node.type === 'ANIME')

  return getRelation(animeRelations, 'PARENT') || getRelation(animeRelations, 'PREQUEL') || getRelation(animeRelations, 'SEQUEL')
}

function getRelation (list, type) {
  return list.find(({ relationType }) => relationType === type)?.node.id
}

// TODO: https://anilist.co/anime/13055/
async function getAniDBEpisodeFromAL ({ media, episode }, { episodes, episodeCount, specialCount }) {
  console.log('getting AniDB EpID for Mal EP', { episode, episodes })
  if (!episode || !Object.values(episodes).length) return
  // if media has no specials or their episode counts don't match
  if (!specialCount || (media.episodes && media.episodes === episodeCount && episodes[Number(episode)])) return episodes[Number(episode)]
  console.log('EP count doesn\'t match, checking by air date')
  const res = await anilistClient.episodeDate({ id: media.id, ep: episode })
  // TODO: if media only has one episode, and airdate doesn't exist use start/release/end dates
  const alDate = new Date((res.data.AiringSchedule?.airingAt || 0) * 1000)

  return getEpisodeNumberByAirDate(alDate, episodes, episode)
}

export function getEpisodeNumberByAirDate (alDate, episodes, episode) {
  if (!+alDate) return episodes[Number(episode)] || episodes[1] // what the fuck, are you braindead anilist?, the source episode number to play is from an array created from AL ep count, so how come it's missing?
  // 1 is key for episod 1, not index

  // find closest episodes by air date, multiple episodes can have the same air date distance
  // ineffcient but reliable
  const closestEpisodes = Object.values(episodes).reduce((prev, curr) => {
    if (!prev[0]) return [curr]
    const prevDate = Math.abs(+new Date(prev[0]?.airdate) - alDate)
    const currDate = Math.abs(+new Date(curr.airdate) - alDate)
    if (prevDate === currDate) {
      prev.push(curr)
      return prev
    }
    if (currDate < prevDate) return [curr]
    return prev
  }, [])

  console.log({ closestEpisodes })

  return closestEpisodes.reduce((prev, curr) => {
    return Math.abs(curr.episodeNumber - episode) < Math.abs(prev.episodeNumber - episode) ? curr : prev
  })
}

async function getToshoEntriesForMedia (media, episode, { mappings }, quality) {
  const promises = []

  if (episode) {
    const { anidbEid } = episode

    console.log('fetching episode', anidbEid, quality)

    promises.push(fetchSingleEpisodeForAnidb({ id: anidbEid, quality }))
  } else {
    // TODO: look for episodes via.... title?
  }

  // look for batches and movies
  const movie = isMovie(media)
  if (mappings.anidb_id && media.status === 'FINISHED' && (movie || media.episodes !== 1)) {
    promises.push(fetchBatchesForAnidb({ episodeCount: media.episodes, id: mappings.anidb_id, quality, movie }))
    console.log('fetching batch', quality, movie)
    if (!movie) {
      const courRelation = getSplitCourRelation(media)
      if (courRelation) {
        console.log('found split cour!')
        const episodeCount = (media.episodes || 0) + (courRelation.episodes || 0)
        try {
          const mappingsResponse = await fetch('https://api.ani.zip/mappings?anilist_id=' + courRelation.id)
          const json = await mappingsResponse.json()
          console.log('found mappings for split cour', !!json.mappings.anidb_id)
          if (json.mappings.anidb_id) promises.push(fetchBatchesForAnidb({ episodeCount, id: json.mappings.anidb_id, quality }))
        } catch (e) {
          console.error('failed getting split-cour data', e)
        }
      }
    }
  }

  return mapToshoEntries((await Promise.all(promises)).flat())
}

function getSplitCourRelation (media) {
  // Part 2 / Cour 3 / 4th Cour
  if (isTitleSplitCour(media)) return getCourPrequel(media)

  // Part 1 of split cour which usually doesn't get labeled as split cour
  // sequel can not exist
  return getCourSequel(media)
}

const courRegex = /[2-9](?:nd|rd|th) Cour|Cour [2-9]|Part [2-9]/i

function isTitleSplitCour (media) {
  const titles = [...Object.values(media.title), ...media.synonyms]

  console.log('checking cour titles', titles)

  return titles.some(title => courRegex.test(title))
}

const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const getDate = ({ seasonYear, season }) => +new Date(`${seasonYear}-${seasons.indexOf(season) * 4 || 1}-01`)

function getMediaDate (media) {
  if (media.startDate) return +new Date(Object.values(media.startDate).join(' '))
  return getDate(media)
}

function getCourSequel (media) {
  const mediaDate = getMediaDate(media)
  const animeRelations = media.relations.edges.filter(({ node, relationType }) => {
    if (node.type !== 'ANIME') return false
    if (node.status !== 'FINISHED') return false
    if (relationType !== 'SEQUEL') return false
    if (!['OVA', 'TV'].some(format => node.format === format)) return false // not movies or ona's
    if (mediaDate > getMediaDate(node)) return false // node needs to be released after media to be a sequel
    return isTitleSplitCour(node)
  }).map(({ node }) => node)

  if (!animeRelations.length) return false

  // get closest sequel
  return animeRelations.reduce((prev, curr) => {
    return getMediaDate(prev) - mediaDate > getMediaDate(curr) - mediaDate ? curr : prev
  })
}

function getCourPrequel (media) {
  const mediaDate = getMediaDate(media)
  const animeRelations = media.relations.edges.filter(({ node, relationType }) => {
    if (node.type !== 'ANIME') return false
    if (node.status !== 'FINISHED') return false
    if (relationType !== 'PREQUEL') return false
    if (!['OVA', 'TV'].some(format => node.format === format)) return false
    if (mediaDate < getMediaDate(node)) return false // node needs to be released before media to be a prequel
    return true
  }).map(({ node }) => node)

  if (!animeRelations.length) {
    console.error('Detected split count but couldn\'t find prequel', media)
    return false
  }

  // get closest prequel
  return animeRelations.reduce((prev, curr) => {
    return mediaDate - getMediaDate(prev) > mediaDate - getMediaDate(curr) ? curr : prev
  })
}

function isMovie (media) {
  if (media.format === 'MOVIE') return true
  if ([...Object.values(media.title), ...media.synonyms].some(title => title?.toLowerCase().includes('movie'))) return true
  // if (!getParentForSpecial(media)) return true // TODO: this is good for checking movies, but false positives with normal TV shows
  return media.duration > 80 && media.episodes === 1
}

const QUALITIES = ['1080', '720', '540', '480']

const ANY = 'e*|a*|r*|i*|o*'

function buildToshoQuery (quality) {
  let query = `&qx=1&q=!("${exclusions.join('"|"')}")`
  if (quality) {
    query += `((${ANY}|"${quality}") !"${QUALITIES.filter(q => q !== quality).join('" !"')}")`
  } else {
    query += ANY // HACK: tosho NEEDS a search string, so we lazy search a single common vowel
  }

  return query
}

async function fetchBatchesForAnidb ({ episodeCount, id, quality, movie = null }) {
  try {
    const queryString = buildToshoQuery(quality)
    const torrents = await fetch(settings.value.toshoURL + 'json?order=size-d&aid=' + id + queryString)

    // safe both if AL includes EP 0 or doesn't
    const batches = (await torrents.json()).filter(entry => entry.num_files >= episodeCount)
    if (!movie) {
      for (const batch of batches) batch.type = 'batch'
    }
    console.log({ batches })
    return batches
  } catch (error) {
    console.log('failed fetching batch', error)
    return []
  }
}

async function fetchSingleEpisodeForAnidb ({ id, quality }) {
  try {
    const queryString = buildToshoQuery(quality)
    const torrents = await fetch(settings.value.toshoURL + 'json?eid=' + id + queryString)

    const episodes = await torrents.json()
    console.log({ episodes })
    return episodes
  } catch (error) {
    console.log('failed fetching single episode', error)
    return []
  }
}

function mapToshoEntries (entries) {
  return entries.map(entry => {
    return {
      title: entry.title || entry.torrent_name,
      link: entry.magnet_uri,
      id: entry.nyaa_id, // TODO: used for sneedex mappings, remove later
      seeders: entry.seeders >= 30000 ? 0 : entry.seeders,
      leechers: entry.leechers >= 30000 ? 0 : entry.leechers,
      downloads: entry.torrent_downloaded_count,
      hash: entry.info_hash,
      size: entry.total_size && fastPrettyBytes(entry.total_size),
      verified: !!entry.anidb_fid,
      type: entry.type,
      date: entry.timestamp && new Date(entry.timestamp * 1000)
    }
  })
}

function dedupeEntries (entries) {
  const deduped = {}
  for (const entry of entries) {
    if (deduped[entry.hash]) {
      const dupe = deduped[entry.hash]
      dupe.title ??= entry.title
      dupe.link ??= entry.link
      dupe.id ||= entry.id
      dupe.seeders ||= entry.seeders >= 30000 ? 0 : entry.seeders
      dupe.leechers ||= entry.leechers >= 30000 ? 0 : entry.leechers
      dupe.downloads ||= entry.downloads
      dupe.size ||= entry.size
      dupe.verified ||= entry.verified
      dupe.date ||= entry.date
      dupe.type ??= entry.type
    } else {
      deduped[entry.hash] = entry
    }
  }

  return Object.values(deduped)
}
