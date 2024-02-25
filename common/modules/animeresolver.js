import { toast } from 'svelte-sonner'
import { anilistClient } from './anilist.js'
import { anitomyscript } from './anime.js'
import { PromiseBatch } from './util.js'

const postfix = {
  1: 'st', 2: 'nd', 3: 'rd'
}

export default new class AnimeResolver {
  // name: media cache from title resolving
  animeNameCache = {}

  /**
   * @param {import('anitomyscript').AnitomyResult} obj
   * @returns {string}
   */
  getCacheKeyForTitle (obj) {
    let key = obj.anime_title
    if (obj.anime_year) key += obj.anime_year
    return key
  }

  /**
   * resolve anime name based on file name and store it
   * @param {import('anitomyscript').AnitomyResult} parseObject
   */
  async findAnimeByTitle (parseObject) {
    const name = parseObject.anime_title
    const variables = { name, perPage: 10, status: ['RELEASING', 'FINISHED'], sort: 'SEARCH_MATCH' }
    if (parseObject.anime_year) variables.year = parseObject.anime_year

    // inefficient but readable

    let media = null
    try {
    // change S2 into Season 2 or 2nd Season
      const match = variables.name.match(/ S(\d+)/)
      const oldname = variables.name
      if (match) {
        if (Number(match[1]) === 1) { // if this is S1, remove the " S1" or " S01"
          variables.name = variables.name.replace(/ S(\d+)/, '')
          media = await anilistClient.alSearch(variables)
        } else {
          variables.name = variables.name.replace(/ S(\d+)/, ` ${Number(match[1])}${postfix[Number(match[1])] || 'th'} Season`)
          media = await anilistClient.alSearch(variables)
          if (!media) {
            variables.name = oldname.replace(/ S(\d+)/, ` Season ${Number(match[1])}`)
            media = await anilistClient.alSearch(variables)
          }
        }
      } else {
        media = await anilistClient.alSearch(variables)
      }

      // remove - :
      if (!media) {
        const match = variables.name.match(/[-:]/g)
        if (match) {
          variables.name = variables.name.replace(/[-:]/g, '')
          media = await anilistClient.alSearch(variables)
        }
      }
      // remove (TV)
      if (!media) {
        const match = variables.name.match(/\(TV\)/)
        if (match) {
          variables.name = variables.name.replace('(TV)', '')
          media = await anilistClient.alSearch(variables)
        }
      }
      // check adult
      if (!media) {
        variables.isAdult = true
        media = await anilistClient.alSearch(variables)
      }
    } catch (e) { }

    if (media) this.animeNameCache[this.getCacheKeyForTitle(parseObject)] = media
  }

  // id keyed cache for anilist media
  animeCache = {}

  // TODO: this should use global anime cache once that is create
  /**
   * @param {number} id
   * @returns {any}
   */
  getAnimeById (id) {
    if (!this.animeCache[id]) this.animeCache[id] = anilistClient.searchIDSingle({ id })

    return this.animeCache[id]
  }

  // TODO: anidb aka true episodes need to be mapped to anilist episodes a bit better
  /**
   * @param {string | string[]} fileName
   * @returns {Promise<any[]>}
   */
  async resolveFileAnime (fileName) {
    const parseObjs = await anitomyscript(fileName)

    // batches promises in 10 at a time, because of CF burst protection, which still sometimes gets triggered :/
    const uniq = {}
    for (const obj of parseObjs) {
      const key = this.getCacheKeyForTitle(obj)
      if (key in this.animeNameCache) continue
      uniq[key] = obj
    }
    await PromiseBatch(this.findAnimeByTitle.bind(this), Object.values(uniq), 10)

    const fileAnimes = []
    for (const parseObj of parseObjs) {
      let failed = false
      let episode
      let media = this.animeNameCache[this.getCacheKeyForTitle(parseObj)]
      // resolve episode, if movie, dont.
      const maxep = media?.nextAiringEpisode?.episode || media?.episodes
      if ((media?.format !== 'MOVIE' || maxep) && parseObj.episode_number) {
        if (Array.isArray(parseObj.episode_number)) {
          // is an episode range
          if (parseInt(parseObj.episode_number[0]) === 1) {
            // if it starts with #1 and overflows then it includes more than 1 season in a batch, cant fix this cleanly, name is parsed per file basis so this shouldnt be an issue
            episode = `${parseObj.episode_number[0]} ~ ${parseObj.episode_number[1]}`
          } else {
            if (maxep && parseInt(parseObj.episode_number[1]) > maxep) {
              // get root media to start at S1, instead of S2 or some OVA due to parsing errors
              // this is most likely safe, if it was relative episodes then it would likely use an accurate title for the season
              // if they didnt use an accurate title then its likely an absolute numbering scheme
              // parent check is to break out of those incorrectly resolved OVA's
              // if we used anime season to resolve anime name, then there's no need to march into prequel!
              const prequel = !parseObj.anime_season && (this.findEdge(media, 'PREQUEL')?.node || ((media.format === 'OVA' || media.format === 'ONA') && this.findEdge(media, 'PARENT')?.node))
              const root = prequel && (await this.resolveSeason({ media: (await this.getAnimeById(prequel.id)).data.Media, force: true })).media

              // if highest value is bigger than episode count or latest streamed episode +1 for safety, parseint to math.floor a number like 12.5 - specials - in 1 go
              const result = await this.resolveSeason({ media: root || media, episode: parseObj.episode_number[1], increment: !parseObj.anime_season ? null : true })
              media = result.rootMedia
              const diff = parseObj.episode_number[1] - result.episode
              episode = `${parseObj.episode_number[0] - diff} ~ ${result.episode}`
              failed = result.failed
            } else {
              // cant find ep count or range seems fine
              episode = `${Number(parseObj.episode_number[0])} ~ ${Number(parseObj.episode_number[1])}`
            }
          }
        } else {
          if (maxep && parseInt(parseObj.episode_number) > maxep) {
            // see big comment above
            const prequel = !parseObj.anime_season && (this.findEdge(media, 'PREQUEL')?.node || ((media.format === 'OVA' || media.format === 'ONA') && this.findEdge(media, 'PARENT')?.node))
            const root = prequel && (await this.resolveSeason({ media: (await this.getAnimeById(prequel.id)).data.Media, force: true })).media

            // value bigger than episode count
            const result = await this.resolveSeason({ media: root || media, episode: parseInt(parseObj.episode_number), increment: !parseObj.anime_season ? null : true })
            media = result.rootMedia
            episode = result.episode
            failed = result.failed
          } else {
            // cant find ep count or episode seems fine
            episode = Number(parseObj.episode_number)
          }
        }
      }
      fileAnimes.push({
        episode: episode || parseObj.episode_number,
        parseObject: parseObj,
        media,
        failed
      })
    }
    return fileAnimes
  }

  findEdge (media, type, formats = ['TV', 'TV_SHORT'], skip) {
    let res = media.relations.edges.find(edge => {
      if (edge.relationType === type) {
        return formats.includes(edge.node.format)
      }
      return false
    })
    // this is hit-miss
    if (!res && !skip && type === 'SEQUEL') res = this.findEdge(media, type, formats = ['TV', 'TV_SHORT', 'OVA'], true)
    return res
  }

  // note: this doesnt cover anime which uses partially relative and partially absolute episode number, BUT IT COULD!
  /**
   *
   * @param {{ media:any, episode?:number, force?:boolean, increment?:boolean, offset?: number, rootMedia?:any }} opts
   * @returns
   */
  async resolveSeason (opts) {
    // media, episode, increment, offset, force
    if (!opts.media || !(opts.episode || opts.force)) throw new Error('No episode or media for season resolve!')

    let { media, episode, increment, offset = 0, rootMedia = opts.media, force } = opts

    const rootHighest = (rootMedia.nextAiringEpisode?.episode || rootMedia.episodes)

    const prequel = !increment && this.findEdge(media, 'PREQUEL')?.node
    const sequel = !prequel && (increment || increment == null) && this.findEdge(media, 'SEQUEL')?.node
    const edge = prequel || sequel
    increment = increment ?? !prequel

    if (!edge) {
      const obj = { media, episode: episode - offset, offset, increment, rootMedia, failed: true }
      if (!force) {
        console.warn('Error in parsing!', obj)
        toast('Parsing Error', {
          description: `Failed resolving anime episode!\n${media.title.userPreferred} - ${episode - offset}`
        })
      }
      return obj
    }
    media = (await this.getAnimeById(edge.id)).data.Media

    const highest = media.nextAiringEpisode?.episode || media.episodes

    const diff = episode - (highest + offset)
    offset += increment ? rootHighest : highest
    if (increment) rootMedia = media

    // force marches till end of tree, no need for checks
    if (!force && diff <= rootHighest) {
      episode -= offset
      return { media, episode, offset, increment, rootMedia }
    }

    return this.resolveSeason({ media, episode, increment, offset, rootMedia, force })
  }
}()
