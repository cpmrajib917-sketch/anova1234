// @ts-nocheck
import { Anime } from '../types';
import { ref, get, set } from "firebase/database";
import { db } from "./firebase";

const BASE_URL = "https://api.kryzox.xyz";

const cache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL for ultimate speed

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const activePromises = new Map<string, Promise<any>>();

export function dedupeRequest<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  let active = activePromises.get(key);
  if (!active) {
    active = fetcher().then((res) => {
      activePromises.delete(key);
      return res;
    }).catch((err) => {
      activePromises.delete(key);
      throw err;
    });
    activePromises.set(key, active);
  }
  return active;
}

export function getPerfSettings() {
  const defaults = {
    smartPrefetch: true,
    smartCache: true,
    autoServerRanking: true,
    autoRetry: true,
    autoFailover: true,
    dnsPrefetch: true,
    preconnect: true,
    backgroundPreload: true,
    responseCache: true,
    compression: true,
  };
  try {
    const saved = localStorage.getItem('anova_perf_settings');
    if (saved) {
      return { ...defaults, ...JSON.parse(saved) };
    }
  } catch (_) {}
  return defaults;
}

export const apiCache = {
  get: (key: string): any => {
    const settings = getPerfSettings();
    if (!settings.smartCache && !settings.responseCache) {
      return null;
    }
    // Memory Cache
    const mem = cache.get(key);
    if (mem && (Date.now() - mem.timestamp < CACHE_TTL)) {
      return mem.data;
    }
    // LocalStorage Cache
    try {
      const stored = localStorage.getItem(`swr_v4_${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        cache.set(key, { data: parsed, timestamp: Date.now() });
        return parsed;
      }
    } catch (_) {}
    return null;
  },
  set: (key: string, data: any) => {
    const settings = getPerfSettings();
    if (!settings.smartCache && !settings.responseCache) {
      return;
    }
    if (data === null || data === undefined) return;
    cache.set(key, { data, timestamp: Date.now() });
    try {
      localStorage.setItem(`swr_v4_${key}`, JSON.stringify(data));
    } catch (_) {}
  }
};

export interface ApiLog {
  id: string;
  url: string;
  statusCode: number | string;
  responseBody: string;
  headers: Record<string, string>;
  timing: number;
  retryCount: number;
  error?: string;
  timestamp: number;
}

if (typeof window !== 'undefined') {
  (window as any).__anova_api_logs = (window as any).__anova_api_logs || [];
}

export function logApiRequest(log: ApiLog) {
  if (typeof window !== 'undefined') {
    (window as any).__anova_api_logs = [log, ...(window as any).__anova_api_logs].slice(0, 50);
    window.dispatchEvent(new CustomEvent('anova_api_log_added', { detail: log }));
  }
}

async function fetchApi(endpoint: string, retries = 3, delayMs = 1000, currentAttempt = 0): Promise<any> {
  const settings = getPerfSettings();
  const cacheKey = `fetch_${endpoint}`;
  const localData = apiCache.get(cacheKey);
  const fullUrl = `${BASE_URL}${endpoint}`;
  const startTime = performance.now();

  const fetcherPromise = (async () => {
    let statusCode: number | string = 'Unknown';
    let responseText = '';
    let headersObj: Record<string, string> = {};
    let errorMsg = '';

    // If autoRetry is disabled, force 0 retries
    const activeRetries = settings.autoRetry ? retries : 0;

    try {
      const res = await fetch(fullUrl);
      statusCode = res.status;
      
      try {
        res.headers.forEach((val, key) => {
          headersObj[key] = val;
        });
      } catch (_) {}

      const contentType = res.headers.get('content-type') || '';
      responseText = await res.clone().text();

      if (!res.ok) {
        if (responseText.includes('cloudflare') || responseText.includes('cf-browser-verification') || responseText.includes('Just a moment...')) {
          errorMsg = `Cloudflare protection page detected. Status: ${res.status}`;
        } else if (contentType.includes('text/html') || responseText.trim().startsWith('<')) {
          errorMsg = `HTML returned instead of JSON. Status: ${res.status}`;
        } else {
          errorMsg = `HTTP Error ${res.status}`;
        }

        const duration = Math.round(performance.now() - startTime);
        
        // Log Perf metrics
        if (typeof window !== 'undefined') {
          const m = (window as any).__anova_perf_metrics || { apiResponseTimes: [], embedLoadTimes: [], playerInitTimes: [], cacheHits: 0, cacheMisses: 0, retries: 0 };
          m.apiResponseTimes.push(duration);
          m.retries += currentAttempt;
          (window as any).__anova_perf_metrics = m;
        }

        logApiRequest({
          id: `${Date.now()}-${Math.random()}`,
          url: fullUrl,
          statusCode,
          responseBody: responseText.slice(0, 500),
          headers: headersObj,
          timing: duration,
          retryCount: currentAttempt,
          error: errorMsg,
          timestamp: Date.now()
        });

        if (res.status === 429 || res.status >= 500) {
          if (activeRetries > 0) {
            await delay(delayMs);
            return fetchApi(endpoint, activeRetries - 1, delayMs * 2, currentAttempt + 1);
          }
          if (localData) return localData;
        }
        throw new Error(errorMsg);
      }

      if (contentType.includes('text/html') || responseText.trim().startsWith('<')) {
        errorMsg = "HTML returned instead of JSON despite 200 OK status";
        if (responseText.includes('cloudflare') || responseText.includes('cf-browser-verification') || responseText.includes('Just a moment...')) {
          errorMsg = "Cloudflare security/challenge block page (200 OK HTML)";
        }
        
        const duration = Math.round(performance.now() - startTime);
        
        // Log Perf metrics
        if (typeof window !== 'undefined') {
          const m = (window as any).__anova_perf_metrics || { apiResponseTimes: [], embedLoadTimes: [], playerInitTimes: [], cacheHits: 0, cacheMisses: 0, retries: 0 };
          m.apiResponseTimes.push(duration);
          m.retries += currentAttempt;
          (window as any).__anova_perf_metrics = m;
        }

        logApiRequest({
          id: `${Date.now()}-${Math.random()}`,
          url: fullUrl,
          statusCode,
          responseBody: responseText.slice(0, 500),
          headers: headersObj,
          timing: duration,
          retryCount: currentAttempt,
          error: errorMsg,
          timestamp: Date.now()
        });

        if (activeRetries > 0) {
          await delay(delayMs);
          return fetchApi(endpoint, activeRetries - 1, delayMs * 2, currentAttempt + 1);
        }
        if (localData) return localData;
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e: any) {
        errorMsg = `JSON parsing failed: ${e.message}`;
        const duration = Math.round(performance.now() - startTime);
        logApiRequest({
          id: `${Date.now()}-${Math.random()}`,
          url: fullUrl,
          statusCode,
          responseBody: responseText.slice(0, 500),
          headers: headersObj,
          timing: duration,
          retryCount: currentAttempt,
          error: errorMsg,
          timestamp: Date.now()
        });
        throw new Error(errorMsg);
      }

      const duration = Math.round(performance.now() - startTime);

      // Log Perf metrics
      if (typeof window !== 'undefined') {
        const m = (window as any).__anova_perf_metrics || { apiResponseTimes: [], embedLoadTimes: [], playerInitTimes: [], cacheHits: 0, cacheMisses: 0, retries: 0 };
        m.apiResponseTimes.push(duration);
        m.retries += currentAttempt;
        (window as any).__anova_perf_metrics = m;
      }

      logApiRequest({
        id: `${Date.now()}-${Math.random()}`,
        url: fullUrl,
        statusCode,
        responseBody: responseText.slice(0, 100),
        headers: headersObj,
        timing: duration,
        retryCount: currentAttempt,
        timestamp: Date.now()
      });

      apiCache.set(cacheKey, data);
      return data;

    } catch (error: any) {
      if (statusCode === 'Unknown') {
        statusCode = 'CORS Blocked/Network Error';
        errorMsg = error.message || 'Network fetch rejected (likely CORS, CSP or server offline)';
      } else {
        errorMsg = error.message || 'Unknown fetch error';
      }

      const duration = Math.round(performance.now() - startTime);

      // Log Perf metrics
      if (typeof window !== 'undefined') {
        const m = (window as any).__anova_perf_metrics || { apiResponseTimes: [], embedLoadTimes: [], playerInitTimes: [], cacheHits: 0, cacheMisses: 0, retries: 0 };
        m.apiResponseTimes.push(duration);
        m.retries += currentAttempt;
        (window as any).__anova_perf_metrics = m;
      }

      logApiRequest({
        id: `${Date.now()}-${Math.random()}`,
        url: fullUrl,
        statusCode,
        responseBody: responseText ? responseText.slice(0, 500) : 'No response content available due to network error.',
        headers: headersObj,
        timing: duration,
        retryCount: currentAttempt,
        error: errorMsg,
        timestamp: Date.now()
      });

      console.warn(`AnOvA client status: fetch failed for ${endpoint} (${errorMsg}).`);
      
      if (activeRetries > 0) {
        await delay(delayMs);
        return fetchApi(endpoint, activeRetries - 1, delayMs * 2, currentAttempt + 1);
      }

      // Auto failover support: return local stale data if failover is enabled
      if (settings.autoFailover && localData) {
        console.info(`Auto Failover triggered for ${endpoint}. Returning stale local cache.`);
        return localData;
      }
      return null;
    }
  })();

  const dedupedPromise = dedupeRequest(cacheKey, () => fetcherPromise);

  if (localData) {
    dedupedPromise.catch(() => {});
    return localData;
  }

  return dedupedPromise;
}

export const fallbackAnimes = [
  {
    id: "1",
    title: "One Piece",
    poster: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 1100,
    rating: "9.1",
    description: "Gold Roger was known as the Pirate King, the strongest and most infamous being to have sailed the Grand Line. The capture and execution of Roger by the World Government brought a change throughout the world. His last words before his death revealed the existence of the greatest treasure in the world, One Piece. It was this revelation that brought about the Grand Age of Pirates, men who dreamed of finding One Piece—which promises an unlimited amount of riches and fame—and quite possibly the pinnacle of glory and the title of the Pirate King.",
    genres: ["Action", "Adventure", "Fantasy", "Shounen"],
    studio: "Toei Animation"
  },
  {
    id: "2",
    title: "Naruto: Shippuden",
    poster: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 500,
    rating: "8.6",
    description: "It has been two and a half years since Naruto Uzumaki left Konohagakure, the Hidden Leaf Village, for intense training following events which fueled his desire to be stronger. Now the Akatsuki, the mysterious organization of elite rogue ninja, is closing in on their grand plan which may threaten the safety of the entire shinobi world.",
    genres: ["Action", "Adventure", "Fantasy", "Shounen"],
    studio: "Studio Pierrot"
  },
  {
    id: "3",
    title: "Attack on Titan",
    poster: "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 75,
    rating: "9.0",
    description: "Centuries ago, mankind was slaughtered to near extinction by monstrous humanoid creatures called titans, forcing humans to hide in fear behind enormous concentric walls. What makes these giants truly terrifying is that their taste for human flesh is not born of hunger but what seems to be out of pleasure. To ensure their survival, the remnants of humanity began living within defensive barriers, resulting in one hundred years without a single titan encounter.",
    genres: ["Action", "Drama", "Fantasy", "Mystery"],
    studio: "MAPPA"
  },
  {
    id: "4",
    title: "Demon Slayer: Kimetsu no Yaiba",
    poster: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 55,
    rating: "8.7",
    description: "Ever since the death of his father, the burden of supporting the family has fallen upon Tanjirou Kamado's shoulders. Though living impoverished on a remote mountain, the Kamado family are able to enjoy a relatively peaceful and happy life. One day, Tanjirou decides to go down to the local village to make a little money by selling charcoal. On his way back, night falls, forcing Tanjirou to shelter in the house of a strange man, who warns him of the existence of flesh-eating demons that lurk in the woods at night.",
    genres: ["Action", "Fantasy", "Historical", "Shounen"],
    studio: "ufotable"
  },
  {
    id: "5",
    title: "Jujutsu Kaisen",
    poster: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 47,
    rating: "8.8",
    description: "Idly indulging in baseless paranormal activities with the Occult Club, high schooler Yuuji Itadori spends his days at either the clubroom or the hospital, where he visits his bedridden grandfather. However, this leisurely lifestyle soon takes a turn for the strange when he unknowingly encounters a cursed item. Triggering a chain of supernatural occurrences, Yuuji finds himself suddenly thrust into the world of Curses—terrible beings formed from human malice and negativity—after swallowing the said item, revealed to be a finger belonging to the demon Ryomen Sukuna, the 'King of Curses.'",
    genres: ["Action", "Fantasy", "School", "Shounen"],
    studio: "MAPPA"
  },
  {
    id: "6",
    title: "Solo Leveling",
    poster: "https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 12,
    rating: "8.5",
    description: "In a world where hunters, humans who possess supernatural abilities, must battle deadly monsters to protect mankind from quite certain annihilation, a notoriously weak hunter named Sung Jinwoo finds himself in a struggle for survival. After narrowly surviving an overwhelmingly powerful double dungeon that nearly wipes out his entire party, a mysterious program called the System selects him as its sole player and in turn, gives him the extremely rare ability to level up in strength, possibly beyond any known limits.",
    genres: ["Action", "Adventure", "Fantasy"],
    studio: "A-1 Pictures"
  },
  {
    id: "7",
    title: "Chainsaw Man",
    poster: "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 12,
    rating: "8.6",
    description: "Denji has a simple dream—to live a happy and peaceful life, spending time with a girl he likes. This is a far cry from reality, however, as Denji is forced by the yakuza into killing devils in order to pay off his crushing debts. Using his pet devil Pochita as a weapon, he is ready to do anything for a bit of cash. Unfortunately, he outlives his usefulness and is murdered by a devil in contract with the yakuza. However, in an unexpected turn of events, Pochita merges with Denji's dead body and grants him the powers of a chainsaw devil.",
    genres: ["Action", "Comedy", "Drama", "Fantasy"],
    studio: "MAPPA"
  },
  {
    id: "8",
    title: "Frieren: Beyond Journey's End",
    poster: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 28,
    rating: "9.2",
    description: "The demon king has been defeated, and the victorious hero party returns home before disbanding. The four—mage Frieren, hero Himmel, priest Heiter, and warrior Eisen—recall their decade-long journey as the moment to bid each other farewell arrives. But the passage of time is different for elves, thus Frieren witnesses her companions slowly pass away one by one. Before his death, Heiter manages to foist a young human apprentice named Fern onto Frieren. Driven by her desire to collect countless magic spells, the duo embarks on a journey, revisiting the places that the heroes of yore once visited.",
    genres: ["Adventure", "Drama", "Fantasy"],
    studio: "Madhouse"
  },
  {
    id: "9",
    title: "Sakamoto Days",
    poster: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 12,
    rating: "8.4",
    description: "Taro Sakamoto was an elite assassin, feared by bad guys and admired by other assassins. But one day, he fell in love! He quit his job, got married, had a child, and got fat. Now, he's a happy-go-lucky convenience store owner. But can Sakamoto keep his peaceful family life safe from the underworld?",
    genres: ["Action", "Comedy"],
    studio: "TMS Entertainment"
  },
  {
    id: "10",
    title: "Dandadan",
    poster: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 12,
    rating: "8.3",
    description: "A high school girl named Momo Ayase who believes in ghosts, and her classmate Ken Takakura, an occult geek who believes in aliens. To determine who is correct, they bet and visit separate paranormal hotspots, only to find that both ghosts and aliens are very real!",
    genres: ["Action", "Comedy", "Supernatural"],
    studio: "Science SARU"
  },
  {
    id: "11",
    title: "Overflow",
    poster: "https://images.unsplash.com/photo-1541562232579-512a21360020?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1541562232579-512a21360020?w=1200&auto=format&fit=crop&q=80",
    type: "ONA",
    status: "Completed",
    episodes: 8,
    rating: "8.2",
    description: "A playful romantic comedy story centered around the warm, unexpected experiences between longtime childhood friends as they grow up.",
    genres: ["Comedy", "Romance"],
    studio: "Studio Hokiboshi"
  },
  {
    id: "12",
    title: "Bleach",
    poster: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 366,
    rating: "8.5",
    description: "High school student Ichigo Kurosaki, who has the ability to see ghosts, obtains the powers of a Soul Reaper to protect his family and friends.",
    genres: ["Action", "Adventure", "Fantasy"],
    studio: "Studio Pierrot"
  },
  {
    id: "13",
    title: "Black Clover",
    poster: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Completed",
    episodes: 170,
    rating: "8.1",
    description: "Asta and Yuno are orphans raised together on the outskirts of the Clover Kingdom. In a world where everyone has magic, Asta has none, but gains an ultra-rare five-leaf grimoire.",
    genres: ["Action", "Adventure", "Fantasy", "Comedy"],
    studio: "Studio Pierrot"
  },
  {
    id: "14",
    title: "Witch Hat Atelier",
    poster: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 12,
    rating: "8.6",
    description: "In a world where magic is a closely guarded secret, a young girl named Coco dreams of becoming a witch, only to realize that magic is drawn rather than spoken.",
    genres: ["Adventure", "Drama", "Fantasy"],
    studio: "Bug Films"
  },
  {
    id: "15",
    title: "Crowned in a Hundred Days",
    poster: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 12,
    rating: "8.0",
    description: "A classic epic tale of royal lineages and grand battles as a hidden heir rises to power within exactly one hundred days.",
    genres: ["Action", "Historical", "Drama"],
    studio: "Toei Animation"
  },
  {
    id: "16",
    title: "Pokémon Horizons: The Series",
    poster: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80",
    banner: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=1200&auto=format&fit=crop&q=80",
    type: "TV",
    status: "Ongoing",
    episodes: 142,
    rating: "7.9",
    description: "Join Liko and Roy as they embark on endless adventures across multiple regions, discovering mysterious pocket monsters and uncovering ancient secrets.",
    genres: ["Adventure", "Fantasy", "Kids"],
    studio: "OLM"
  },
  {
    id: "17",
    title: "I Became a Legend After My 10 Years in the Noob Academy",
    poster: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300&auto=format&fit=crop&q=65",
    banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=65",
    type: "ONA",
    status: "Ongoing",
    episodes: 24,
    rating: "8.1",
    description: "After being stuck in the starter academy for ten full years due to a system glitch, our protagonist emerges with unparalleled stats, ready to shock the entire world.",
    genres: ["Action", "Comedy", "Fantasy"],
    studio: "AnOvA Production"
  },
  {
    id: "18",
    title: "Your Name (Kimi no Na wa)",
    poster: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300&auto=format&fit=crop&q=65",
    banner: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=65",
    type: "Movie",
    status: "Completed",
    episodes: 1,
    rating: "9.3",
    description: "Mitsuha Miyamizu, a high school girl, yearns to live the life of a boy in Tokyo. Meanwhile, Taki Tachibana, a high school boy, juggles school, work, and architecture aspirations. One day, they wake up to find themselves in each other's bodies. As they adapt, a deep, mystical connection forms, leading them to search for one another across space and time.",
    genres: ["Drama", "Romance", "Supernatural", "Award Winning"],
    studio: "CoMix Wave Films"
  },
  {
    id: "19",
    title: "Suzume no Tojimari",
    poster: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=300&auto=format&fit=crop&q=65",
    banner: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=65",
    type: "Movie",
    status: "Completed",
    episodes: 1,
    rating: "8.9",
    description: "A modern action-adventure road movie where a 17-year-old girl named Suzume helps a mysterious young man close portals that are releasing disasters all across Japan.",
    genres: ["Adventure", "Fantasy", "Drama"],
    studio: "CoMix Wave Films"
  },
  {
    id: "20",
    title: "A Silent Voice (Koe no Katachi)",
    poster: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=300&auto=format&fit=crop&q=65",
    banner: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop&q=65",
    type: "Movie",
    status: "Completed",
    episodes: 1,
    rating: "9.0",
    description: "A former class bully attempts to make amends with a deaf girl he tormented in elementary school, in an emotionally resonant masterpiece dealing with guilt, growth, and redemption.",
    genres: ["Drama", "Shounen", "Award Winning"],
    studio: "Kyoto Animation"
  },
  {
    id: "21",
    title: "Weathering With You (Tenki no Ko)",
    poster: "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=300&auto=format&fit=crop&q=65",
    banner: "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?w=800&auto=format&fit=crop&q=65",
    type: "Movie",
    status: "Completed",
    episodes: 1,
    rating: "8.7",
    description: "A high-school boy who has run away to Tokyo befriends a girl who appears to be able to control the weather by praying, leading to beautiful cosmic adventures.",
    genres: ["Drama", "Romance", "Fantasy"],
    studio: "CoMix Wave Films"
  }
];

const mapAnime = (item: any): Anime => {
  if (!item) return item;

  // On-the-fly Unsplash poster optimization to keep files tiny, lightweight and ultra fast loading
  let poster = item.images?.poster || item.poster || '';
  if (poster.includes('unsplash.com')) {
    poster = poster.replace(/w=\d+/, 'w=300').replace(/q=\d+/, 'q=60');
    if (!poster.includes('w=')) {
      poster += (poster.includes('?') ? '&' : '?') + 'w=300&q=60';
    }
  }

  let banner = item.images?.banner || item.banner || item.images?.poster || item.poster || '';
  if (banner.includes('unsplash.com')) {
    banner = banner.replace(/w=\d+/, 'w=800').replace(/q=\d+/, 'q=65');
    if (!banner.includes('w=')) {
      banner += (banner.includes('?') ? '&' : '?') + 'w=800&q=65';
    }
  }

  return {
    id: String(item.id),
    title: item.titles?.english || item.titles?.romaji || item.title || 'Unknown Title',
    poster,
    banner,
    type: item.type,
    status: item.status,
    episodes: item.episodes_count || item.episodes,
    rating: item.rating,
    description: item.description || item.synopsis,
    genres: item.genres,
    studio: item.studios?.[0]?.name || item.studio,
  };
};

const mapAnimeList = (data: any) => {
  if (!data) return [];
  if (Array.isArray(data)) return data.map(mapAnime);
  if (data?.data?.data && Array.isArray(data.data.data)) return data.data.data.map(mapAnime);
  if (data?.data && Array.isArray(data.data)) return data.data.map(mapAnime);
  if (data?.animes && Array.isArray(data.animes)) return data.animes.map(mapAnime);
  if (data?.suggestions && Array.isArray(data.suggestions)) return data.suggestions.map(mapAnime);
  if (data?.data?.animes && Array.isArray(data.data.animes)) return data.data.animes.map(mapAnime);
  
  if (typeof data === 'object') {
    for (const key in data) {
      if (Array.isArray(data[key])) return data[key].map(mapAnime);
    }
  }
  return [];
};

const getCustomByCategory = async (category: string): Promise<Anime[]> => {
  const cacheKey = `custom_category_${category}`;
  const cached = apiCache.get(cacheKey);

  const fetcher = async () => {
    try {
      const animesRef = ref(db, 'animes');
      const snap = await get(animesRef);
      if (snap.exists()) {
        const val = snap.val();
        const data = Object.values(val)
          .filter((a: any) => a.visibility !== 'draft' && a.categories && a.categories[category] === true)
          .map((a: any) => ({
            ...a,
            id: String(a.id)
          }));
        apiCache.set(cacheKey, data);
        return data;
      }
    } catch (e) {
      console.error("Failed to fetch custom animes for category:", category, e);
    }
    return cached || [];
  };

  const dedupedPromise = dedupeRequest(cacheKey, fetcher);

  if (cached) {
    dedupedPromise.catch(() => {});
    return cached;
  }

  return dedupedPromise;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  return Promise.race([
    promise.catch((err) => {
      console.warn("withTimeout promise rejected, using fallback:", err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
};

export const api = {
  _homeInternal: async () => {
    // Parallelize all three calls: customAnimes, dynamicSections, and liveData
    const customAnimesPromise = (async () => {
      try {
        const snap = await withTimeout(get(ref(db, 'animes')), 3000, null);
        if (snap && snap.exists()) {
          const val = snap.val();
          return Object.values(val).filter((a: any) => a.visibility !== 'draft');
        }
      } catch (e) {
        console.error("Firebase custom animes fetch failed:", e);
      }
      return [];
    })();

    const dynamicSectionsPromise = (async () => {
      try {
        const snap = await withTimeout(get(ref(db, 'homepageSections')), 3000, null);
        if (snap && snap.exists()) {
          return Object.values(snap.val());
        } else {
          const defaultSections = [
            { id: 'featured', name: 'Featured', slug: 'featured', displayOrder: 1, numCards: 12, visible: true, status: 'active' },
            { id: 'trending', name: 'Trending', slug: 'trending', displayOrder: 2, numCards: 12, visible: true, status: 'active' },
            { id: 'popular', name: 'Popular', slug: 'popular', displayOrder: 3, numCards: 12, visible: true, status: 'active' },
            { id: 'topAiring', name: 'Top Airing', slug: 'topAiring', displayOrder: 4, numCards: 12, visible: true, status: 'active' },
            { id: 'recentlyAdded', name: 'Recently Added', slug: 'recentlyAdded', displayOrder: 5, numCards: 12, visible: true, status: 'active' },
            { id: 'latest', name: 'Latest', slug: 'latest', displayOrder: 6, numCards: 12, visible: true, status: 'active' },
            { id: 'favorite', name: 'Most Favorite', slug: 'favorite', displayOrder: 7, numCards: 12, visible: true, status: 'active' },
            { id: 'completed', name: 'Completed', slug: 'completed', displayOrder: 8, numCards: 12, visible: true, status: 'active' },
            { id: 'upcoming', name: 'Upcoming', slug: 'upcoming', displayOrder: 9, numCards: 12, visible: true, status: 'active' },
            { id: 'hindi-dubbed', name: 'Hindi Dubbed', slug: 'hindi-dubbed', displayOrder: 10, numCards: 12, visible: true, status: 'active' },
          ];
          for (const sec of defaultSections) {
            set(ref(db, `homepageSections/${sec.id}`), sec).catch(() => {});
          }
          return defaultSections;
        }
      } catch (e) {
        console.error("Firebase dynamic sections fetch/seed failed:", e);
      }
      return [];
    })();

    const liveDataPromise = (async () => {
      try {
        const live = await withTimeout(fetchApi("/home"), 4500, null);
        if (live && live.data) {
          const d = live.data;
          // Normalize newer kryzox API key names to what the Home page expects
          return {
            ...d,
            mostFavoriteAnimes: d.mostFavoriteAnimes || d.mostFavorite || [],
            completedAnimes: d.completedAnimes || d.justCompleted || [],
            topUpcomingAnimes: d.topUpcomingAnimes || d.topUpcoming || [],
            trending: d.trending || d.spotlight || [],
          };
        }
      } catch (e) {
        console.error("Home API fetch failed, falling back to mock dataset:", e);
      }
      return null;
    })();

    const [customAnimesRaw, rawDynamicSections, liveDataRaw] = await Promise.all([
      customAnimesPromise,
      dynamicSectionsPromise,
      liveDataPromise
    ]);

    const customAnimes = customAnimesRaw as any[];
    const dynamicSections = rawDynamicSections as any[];

    const getCustomLocal = (catName: string) => {
      return customAnimes
        .filter(a => a.categories && a.categories[catName] === true)
        .map(a => ({
          ...a,
          id: String(a.id)
        }));
    };

    let liveData = liveDataRaw;
    if (!liveData) {
      liveData = {
        trending: fallbackAnimes.slice(0, 8),
        mostPopular: fallbackAnimes.slice(3, 11),
        newAdded: fallbackAnimes.slice(5, 13),
        topAiring: {
          all: fallbackAnimes.slice(2, 10)
        },
        latestEpisode: fallbackAnimes.slice(4, 12),
        completedAnimes: fallbackAnimes.filter(a => a.status === 'Completed'),
        topUpcomingAnimes: fallbackAnimes.filter(a => a.status === 'Ongoing').slice(0, 8),
        mostFavoriteAnimes: fallbackAnimes.slice(1, 9)
      };
    }

    return {
      data: {
        trending: [...getCustomLocal('trending'), ...(liveData.trending || []).map(mapAnime)],
        mostPopular: [...getCustomLocal('popular'), ...(liveData.mostPopular || []).map(mapAnime)],
        newAdded: [...getCustomLocal('recentlyAdded'), ...(liveData.newAdded || []).map(mapAnime)],
        topAiring: {
          all: [...getCustomLocal('topAiring'), ...(liveData.topAiring?.all || []).map(mapAnime)]
        },
        latestEpisode: [...getCustomLocal('latest'), ...(liveData.latestEpisode || []).map(mapAnime)],
        completedAnimes: [...getCustomLocal('completed'), ...(liveData.completedAnimes || []).map(mapAnime)],
        topUpcomingAnimes: [...getCustomLocal('upcoming'), ...(liveData.topUpcomingAnimes || []).map(mapAnime)],
        mostFavoriteAnimes: [...getCustomLocal('favorite'), ...(liveData.mostFavoriteAnimes || []).map(mapAnime)]
      },
      dynamicSections: dynamicSections.map(sec => {
        let sectionAnimes: any[] = [];
        if (sec.slug === 'trending') {
          sectionAnimes = [...getCustomLocal('trending'), ...(liveData.trending || []).map(mapAnime)];
        } else if (sec.slug === 'popular' || sec.slug === 'mostPopular') {
          sectionAnimes = [...getCustomLocal('popular'), ...(liveData.mostPopular || []).map(mapAnime)];
        } else if (sec.slug === 'recentlyAdded' || sec.slug === 'recent') {
          sectionAnimes = [...getCustomLocal('recentlyAdded'), ...(liveData.newAdded || []).map(mapAnime)];
        } else if (sec.slug === 'topAiring') {
          sectionAnimes = [...getCustomLocal('topAiring'), ...(liveData.topAiring?.all || []).map(mapAnime)];
        } else if (sec.slug === 'latest' || sec.slug === 'updated') {
          sectionAnimes = [...getCustomLocal('latest'), ...(liveData.latestEpisode || []).map(mapAnime)];
        } else if (sec.slug === 'completed') {
          sectionAnimes = [...getCustomLocal('completed'), ...(liveData.completedAnimes || []).map(mapAnime)];
        } else if (sec.slug === 'upcoming') {
          sectionAnimes = [...getCustomLocal('upcoming'), ...(liveData.topUpcomingAnimes || []).map(mapAnime)];
        } else if (sec.slug === 'favorite') {
          sectionAnimes = [...getCustomLocal('favorite'), ...(liveData.mostFavoriteAnimes || []).map(mapAnime)];
        } else {
          sectionAnimes = customAnimes.filter(a => a.categories && a.categories[sec.slug] === true);
        }

        const seen = new Set<string>();
        const uniqueAnimes = sectionAnimes
          .map(a => ({
            ...a,
            id: String(a.id)
          }))
          .filter(a => {
            if (!a.id || seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
          });

        return {
          ...sec,
          animes: uniqueAnimes.slice(0, sec.numCards || 12)
        };
      })
    };
  },
  home: async (forceFresh = false) => {
    const cacheKey = "api_home_data";
    const cached = apiCache.get(cacheKey);

    const fetcherPromise = api._homeInternal().then((res) => {
      apiCache.set(cacheKey, res);
      return res;
    });

    const dedupedPromise = dedupeRequest(cacheKey, () => fetcherPromise);

    if (cached && !forceFresh) {
      dedupedPromise.catch(() => {});
      return cached;
    }

    return dedupedPromise;
  },
  trending: async () => {
    let liveList: Anime[] = [];
    try {
      const live = await fetchApi("/anime/trending");
      if (live) liveList = mapAnimeList(live);
    } catch (e) {
      console.error("Trending API failed:", e);
      liveList = fallbackAnimes.slice(0, 8);
    }
    const custom = await getCustomByCategory('trending');
    return [...custom, ...liveList];
  },
  topAiring: async () => {
    let liveList: Anime[] = [];
    try {
      const live = await fetchApi("/anime/top-airing");
      if (live) liveList = mapAnimeList(live);
    } catch (e) {
      console.error("Top Airing API failed:", e);
      liveList = fallbackAnimes.slice(2, 10);
    }
    const custom = await getCustomByCategory('topAiring');
    return [...custom, ...liveList];
  },
  popular: async () => {
    let liveList: Anime[] = [];
    try {
      const live = await fetchApi("/anime/most-popular");
      if (live) liveList = mapAnimeList(live);
    } catch (e) {
      console.error("Popular API failed:", e);
      liveList = fallbackAnimes.slice(4, 10);
    }
    const custom = await getCustomByCategory('popular');
    return [...custom, ...liveList];
  },
  recent: async () => {
    let liveList: Anime[] = [];
    try {
      const live = await fetchApi("/anime/recently-added");
      if (live) liveList = mapAnimeList(live);
    } catch (e) {
      console.error("Recent API failed:", e);
      liveList = fallbackAnimes.slice(5, 10);
    }
    const custom = await getCustomByCategory('recentlyAdded');
    return [...custom, ...liveList];
  },
  updated: async () => {
    let liveList: Anime[] = [];
    try {
      const live = await fetchApi("/anime/recently-updated");
      if (live) liveList = mapAnimeList(live);
    } catch (e) {
      console.error("Updated API failed:", e);
      liveList = fallbackAnimes.slice(1, 7);
    }
    const custom = await getCustomByCategory('latest');
    return [...custom, ...liveList];
  },
  search: async (keyword: string, page = 1, filters: { type?: string; status?: string; season?: string; year?: string } = {}) => {
    let customResults: any[] = [];
    try {
      const animesRef = ref(db, 'animes');
      const snap = await get(animesRef);
      if (snap.exists()) {
        const val = snap.val();
        const kw = keyword.toLowerCase().trim();
        customResults = Object.values(val)
          .filter((a: any) => {
            if (a.visibility === 'draft') return false;
            
            // Check keyword
            const title = (a.title || '').toLowerCase();
            const desc = (a.description || '').toLowerCase();
            const studio = (a.studio || '').toLowerCase();
            const genres = a.genres || [];
            const matchesKw = !kw || title.includes(kw) || desc.includes(kw) || studio.includes(kw) || genres.some((g: string) => g.toLowerCase().includes(kw));
            if (!matchesKw) return false;

            // Check filters
            if (filters.type && a.type !== filters.type) return false;
            if (filters.status && a.status !== filters.status) return false;
            if (filters.year && String(a.season_year || a.year) !== String(filters.year)) return false;

            return true;
          })
          .map((a: any) => ({
            ...a,
            id: String(a.id)
          }));
      }
    } catch (e) {
      console.error("Firebase custom search failed:", e);
    }

    let liveResults: any[] = [];
    let total = customResults.length;
    let pages = 1;
    let apiResponse: any = null;

    try {
      // If keyword is completely empty and filters are present, we still want to query.
      // Use 'a' as default keyword to ensure Kryzox returns standard results rather than 400.
      const queryKeyword = keyword || 'a';
      let url = `/anime/search?keyword=${encodeURIComponent(queryKeyword)}&page=${page}`;
      if (filters.type) url += `&type=${filters.type}`;
      if (filters.status) url += `&status=${filters.status}`;
      if (filters.season) url += `&season=${filters.season}`;
      if (filters.year) url += `&year=${filters.year}`;

      apiResponse = await fetchApi(url);
      if (apiResponse) {
        liveResults = mapAnimeList(apiResponse);
        // Safely extract pagination metadata
        const liveTotal = apiResponse.total || apiResponse.data?.total || liveResults.length;
        const livePages = apiResponse.pages || apiResponse.data?.pages || 1;
        total += liveTotal;
        pages = Math.max(pages, livePages);
      }
    } catch (e) {
      console.error("Search API failed:", e);
    }

    // Prevent duplicate cards across custom and live results
    const customIds = new Set(customResults.map(a => String(a.id)));
    const filteredLiveResults = liveResults.filter(a => !customIds.has(String(a.id)));

    if (filteredLiveResults.length === 0 && customResults.length === 0 && keyword) {
      const kw = keyword.toLowerCase().trim();
      const filtered = fallbackAnimes.filter(a => {
        const title = a.title.toLowerCase();
        if (title.includes(kw)) return true;
        if (kw.includes("ovar") || kw.includes("overf") || kw.includes("flow")) {
          if (title.includes("overflow")) return true;
        }
        return a.genres.some(g => g.toLowerCase().includes(kw));
      });
      return {
        data: filtered,
        total: filtered.length,
        pages: 1,
        page: 1
      };
    }

    // Return custom results at the top ONLY on Page 1
    const finalData = page === 1 
      ? [...customResults, ...filteredLiveResults]
      : filteredLiveResults;

    return {
      data: finalData,
      total,
      pages,
      page
    };
  },
  suggestions: async (query: string) => {
    let customResults: any[] = [];
    try {
      const animesRef = ref(db, 'animes');
      const snap = await get(animesRef);
      if (snap.exists()) {
        const val = snap.val();
        const q = query.toLowerCase().trim();
        customResults = Object.values(val)
          .filter((a: any) => {
            if (a.visibility === 'draft') return false;
            const title = (a.title || '').toLowerCase();
            return title.includes(q);
          })
          .map((a: any) => ({
            ...a,
            id: String(a.id)
          }));
      }
    } catch (e) {
      console.error("Firebase custom suggestions search failed:", e);
    }

    let liveResults: any[] = [];
    try {
      const live = await fetchApi(`/suggestion?q=${encodeURIComponent(query)}`);
      if (live) {
        liveResults = mapAnimeList(live);
      }
    } catch (e) {
      console.error("Suggestions API failed:", e);
    }

    if (liveResults.length === 0 && customResults.length === 0) {
      const q = query.toLowerCase().trim();
      const filtered = fallbackAnimes.filter(a => {
        const title = a.title.toLowerCase();
        if (title.includes(q)) return true;
        if (q.includes("ovar") || q.includes("overf") || q.includes("flow")) {
          if (title.includes("overflow")) return true;
        }
        return false;
      });
      return filtered;
    }

    return [...customResults, ...liveResults];
  },
  animeInfo: async (id: string) => {
    const cacheKey = `anime_info_${id}`;
    const cached = apiCache.get(cacheKey);

    const fetcher = async () => {
      try {
        const animeRef = ref(db, `animes/${id}`);
        const snap = await withTimeout(get(animeRef), 2500, null);
        if (snap && snap.exists && snap.exists()) {
          const val = snap.val();
          const mapped = {
            ...val,
            id: String(val.id)
          };
          apiCache.set(cacheKey, mapped);
          return mapped;
        }
      } catch (e) {
        console.error("Firebase custom animeInfo failed:", e);
      }

      try {
        const live = await fetchApi(`/anime/${id}`);
        if (live) {
          const mapped = mapAnime(live);
          apiCache.set(cacheKey, mapped);
          return mapped;
        }
      } catch (e) {
        console.error("Anime Info API failed:", e);
      }
      const matched = fallbackAnimes.find(a => String(a.id) === String(id));
      if (matched) return matched;
      
      return {
        id: String(id),
        title: `Anime #${id}`,
        poster: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80",
        banner: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&auto=format&fit=crop&q=80",
        type: "TV",
        status: "Ongoing",
        episodes: 24,
        rating: "8.5",
        description: `This is a high-speed premium streaming channel for Anime ID #${id}. Start watching your favorite episodes instantly with zero ads, seamless sub/dub switching, and ultra-high speed servers.`,
        genres: ["Action", "Sci-Fi", "Adventure"],
        studio: "AnOvA Production"
      };
    };

    const dedupedPromise = dedupeRequest(cacheKey, fetcher);

    if (cached) {
      dedupedPromise.catch(() => {});
      return cached;
    }

    return dedupedPromise;
  },
  episodes: async (id: string) => {
    const cacheKey = `episodes_${id}`;
    const cached = apiCache.get(cacheKey);

    const fetcher = async () => {
      try {
        const episodesRef = ref(db, `episodes/${id}`);
        const snap = await withTimeout(get(episodesRef), 2500, null);
        if (snap && snap.exists && snap.exists()) {
          const epsObj = snap.val();
          const eps = Object.values(epsObj).filter(Boolean).map((ep: any) => ({
            id: ep.id || `${id}-ep-${ep.number}`,
            number: Number(ep.number),
            title: ep.title || `Episode ${ep.number}`,
            thumbnail: ep.thumbnail || '',
            videoSources: ep.videoSources || {}
          }));
          const sorted = eps.sort((a, b) => a.number - b.number);
          apiCache.set(cacheKey, sorted);
          return sorted;
        }
      } catch (e) {
        console.error("Firebase custom episodes fetch failed:", e);
      }

      try {
        const data = await fetchApi(`/anime/${id}/episodes`);
        if (data) {
          let eps: any[] = [];
          if (Array.isArray(data)) eps = data;
          else if (Array.isArray(data?.data)) eps = data.data;
          else if (Array.isArray(data?.episodes)) eps = data.episodes;
          else if (data?.data?.data && Array.isArray(data.data.data)) eps = data.data.data;
          else if (typeof data === 'object') {
            for (const key in data) {
              if (Array.isArray(data[key])) {
                eps = data[key];
                break;
              }
            }
          }
          if (eps.length > 0) {
            apiCache.set(cacheKey, eps);
            return eps;
          }
        }
      } catch (e) {
        console.error("Episodes API failed:", e);
      }
      
      const matched = fallbackAnimes.find(a => String(a.id) === String(id));
      const totalEp = matched?.episodes || 24;
      const eps = [];
      for (let i = 1; i <= Math.min(totalEp, 200); i++) {
        eps.push({ id: `${id}-ep-${i}`, number: i, title: `Episode ${i}` });
      }
      apiCache.set(cacheKey, eps);
      return eps;
    };

    const dedupedPromise = dedupeRequest(cacheKey, fetcher);

    if (cached) {
      dedupedPromise.catch(() => {});
      return cached;
    }

    return dedupedPromise;
  },
  characters: async (id: string) => {
    try {
      return await fetchApi(`/anime/${id}/characters`);
    } catch (e) {
      return [];
    }
  },
  staff: async (id: string) => {
    try {
      return await fetchApi(`/anime/${id}/staff`);
    } catch (e) {
      return [];
    }
  },
  relations: async (id: string) => {
    try {
      return await fetchApi(`/anime/${id}/relations`);
    } catch (e) {
      return [];
    }
  },
  recommendations: async (id: string) => {
    try {
      return await fetchApi(`/anime/${id}/recommendations`);
    } catch (e) {
      return [];
    }
  },
};

export function prefetchAnime(id: string) {
  if (typeof window === 'undefined' || !id) return;
  const runner = () => {
    api.animeInfo(id).catch(() => {});
    api.episodes(id).catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(runner);
  } else {
    setTimeout(runner, 1000);
  }
}
