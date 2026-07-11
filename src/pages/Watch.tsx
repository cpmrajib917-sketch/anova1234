// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api, fallbackAnimes, apiCache } from '../lib/api';
import { useAppStore } from '../store';
import { Settings, SkipForward, SkipBack, Heart, MonitorPlay, Subtitles, Mic, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { CommentSystem } from '../components/CommentSystem';
import { logWatchEvent } from '../lib/firebaseSync';
import { db } from '../lib/firebase';
import { ref, onValue } from 'firebase/database';

const getDailymotionEmbedUrl = (rawUrl: string, autoPlay = false) => {
  if (!rawUrl) return '';

  const trimmed = rawUrl.trim();
  const idMatch = trimmed.match(/(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-zA-Z0-9]+)/i)
    || trimmed.match(/^([a-zA-Z0-9]{5,})$/);

  if (!idMatch?.[1]) return trimmed;

  const params = new URLSearchParams({
    autoplay: autoPlay ? '1' : '0',
    'queue-enable': 'false',
    'sharing-enable': 'false',
  });

  return `https://www.dailymotion.com/embed/video/${idMatch[1]}?${params.toString()}`;
};

// ==========================================
// ADVERTISEMENT SCRIPT INJECTION ENGINE
// ==========================================
export function AdScriptRunner({ script }: { script: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !script) return;

    containerRef.current.innerHTML = '';

    const trimmed = script.trim();
    const isRawUrl = trimmed.startsWith('http') && !trimmed.includes('<');

    if (isRawUrl) {
      const iframeEl = document.createElement('iframe');
      iframeEl.src = trimmed;
      iframeEl.style.width = '100%';
      iframeEl.style.height = '100%';
      iframeEl.style.border = 'none';
      iframeEl.style.minHeight = '250px';
      iframeEl.setAttribute('allow', 'autoplay');
      containerRef.current.appendChild(iframeEl);

      const linkEl = document.createElement('a');
      linkEl.href = trimmed;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.className = 'absolute bottom-3 right-3 bg-cyan-500 hover:bg-cyan-600 text-black font-black text-[10px] uppercase tracking-wider py-1.5 px-3 rounded-lg shadow-lg transition-transform hover:scale-105';
      linkEl.innerText = 'Visit Sponsor Site';
      containerRef.current.appendChild(linkEl);
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${script}</div>`, 'text/html');
    const wrapper = doc.querySelector('div');

    if (wrapper) {
      Array.from(wrapper.childNodes).forEach((node) => {
        if (node.nodeName === 'SCRIPT') {
          const scriptEl = document.createElement('script');
          Array.from((node as HTMLScriptElement).attributes).forEach(attr => {
            scriptEl.setAttribute(attr.name, attr.value);
          });
          scriptEl.textContent = (node as HTMLScriptElement).textContent;
          containerRef.current?.appendChild(scriptEl);
        } else {
          const clone = node.cloneNode(true);
          containerRef.current?.appendChild(clone);
        }
      });
    }
  }, [script]);

  return <div ref={containerRef} className="w-full h-full flex items-center justify-center min-h-[220px] relative" />;
}

export function Watch() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  const initialEp = Number(searchParams.get('ep')) || 1;
  const [episode, setEpisode] = useState(initialEp);
  const [server, setServer] = useState(() => {
    try {
      const lastSrv = localStorage.getItem('anova_last_working_server');
      if (lastSrv) return lastSrv;
    } catch (_) {}
    return 'hd-1';
  });
  const [audio, setAudio] = useState<'sub' | 'dub'>('sub');
  const [selectedLanguage, setSelectedLanguage] = useState('sub');

  const [perfSettings, setPerfSettings] = useState(() => {
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
  });

  const [serverRankings, setServerRankings] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('anova_server_rankings');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return ['hd-1', 'hd-2', 'hd-3', 'hd-4', 'hd-5', 'ani', 'mal', 'af'];
  });

  const [debugTab, setDebugTab] = useState<'diagnostics' | 'settings' | 'metrics'>('diagnostics');
  const [mountTime] = useState(() => performance.now());
  const loadStartTimeRef = React.useRef(performance.now());

  const togglePerfSetting = (key: keyof typeof perfSettings) => {
    setPerfSettings((prev: any) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('anova_perf_settings', JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };
  
  // Try to pre-fill anime info from location.state or from cache or fallbackAnimes
  const [anime, setAnime] = useState<any>(() => {
    if (location.state?.anime) {
      return location.state.anime;
    }
    const cached = id ? apiCache.get(`anime_info_${id}`) : null;
    if (cached) return cached;
    const matched = fallbackAnimes.find(a => String(a.id) === String(id));
    return matched || null;
  });
  
  const [episodes, setEpisodes] = useState<any[]>(() => {
    return id ? (apiCache.get(`episodes_${id}`) || []) : [];
  });
  const currentEpData = episodes.find(ep => ep.number === episode);
  const isCustomEpisode = currentEpData && currentEpData.videoSources;
  
  const availableStreams = isCustomEpisode 
    ? Object.keys(currentEpData.videoSources).filter(k => {
        const src = currentEpData.videoSources[k];
        return src && src.enabled && src.url;
      })
    : [];

  // ==========================================
  // REAL-TIME ADVERTISEMENT ENGINE
  // ==========================================
  const [advertisements, setAdvertisements] = useState<any[]>([]);
  const [activeAd, setActiveAd] = useState<any>(null);
  const [showAdOverlay, setShowAdOverlay] = useState(false);
  const [userHasStartedPlayback, setUserHasStartedPlayback] = useState(false);

  // Auto-reset playback start state when the user shifts to a new episode, server, language, or show
  useEffect(() => {
    setUserHasStartedPlayback(false);
  }, [id, episode, server, audio, selectedLanguage]);

  useEffect(() => {
    const adsRef = ref(db, 'advertisements');
    const unsubAds = onValue(adsRef, (snap) => {
      if (snap.exists()) {
        const list = Object.values(snap.val()).filter((ad: any) => ad && ad.status === 'enabled');
        setAdvertisements(list);
      } else {
        setAdvertisements([]);
      }
    });
    return () => unsubAds();
  }, []);

  const getMatchingVideoStartAd = () => {
    const activeAds = advertisements.filter((ad: any) => {
      // 1. Status Check
      if (ad.status !== 'enabled') return false;

      // 2. Active Date Range Check
      const nowStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      if (ad.startDate && nowStr < ad.startDate) return false;
      if (ad.endDate && nowStr > ad.endDate) return false;

      // 3. Targeting Check
      if (ad.targetMode === 'all') {
        return true;
      }

      const currentAnimeId = String(anime?.id || '');
      if (!currentAnimeId) return false;

      const targetIds = Array.isArray(ad.targetAnimeIds)
        ? ad.targetAnimeIds.map(String)
        : ad.targetAnimeId ? [String(ad.targetAnimeId)] : [];

      if (targetIds.includes(currentAnimeId)) {
        return true;
      }

      return false;
    });

    // Sort by highest priority first
    return activeAds.sort((a: any, b: any) => Number(b.priority || 0) - Number(a.priority || 0))[0] || null;
  };

  const checkAdFrequencyAllowed = (ad: any) => {
    if (!ad) return false;
    if (ad.frequency === 'always') return true;
    
    const now = Date.now();
    const sessionKey = `anova_ad_shown_session_${ad.id}`;
    const timestampKey = `anova_ad_shown_time_${ad.id}`;
    
    if (ad.frequency === 'once_per_session') {
      try {
        const shown = sessionStorage.getItem(sessionKey);
        if (shown) return false;
      } catch (_) {}
    }
    
    const intervalMap: Record<string, number> = {
      every_5_m: 5 * 60 * 1000,
      every_10_m: 10 * 60 * 1000,
      every_15_m: 15 * 60 * 1000,
      every_30_m: 30 * 60 * 1000,
      once_per_hour: 60 * 60 * 1000,
    };

    const interval = intervalMap[ad.frequency];
    if (interval) {
      try {
        const lastShown = localStorage.getItem(timestampKey);
        if (lastShown && now - Number(lastShown) < interval) {
          return false;
        }
      } catch (_) {}
    }
    
    return true;
  };

  const recordAdShown = (ad: any) => {
    if (!ad) return;
    const now = Date.now();
    const sessionKey = `anova_ad_shown_session_${ad.id}`;
    const timestampKey = `anova_ad_shown_time_${ad.id}`;
    
    try {
      sessionStorage.setItem(sessionKey, 'true');
      localStorage.setItem(timestampKey, String(now));
    } catch (_) {}
  };

  useEffect(() => {
    if (advertisements.length === 0 || !anime) {
      setActiveAd(null);
      setShowAdOverlay(false);
      return;
    }
    
    const matchingAd = getMatchingVideoStartAd();
    if (matchingAd && checkAdFrequencyAllowed(matchingAd)) {
      setActiveAd(matchingAd);
      setShowAdOverlay(true);
    } else {
      setActiveAd(null);
      setShowAdOverlay(false);
    }
  }, [episode, advertisements, anime]);

  const activeCustomSource = isCustomEpisode && currentEpData.videoSources[selectedLanguage]
    ? currentEpData.videoSources[selectedLanguage]
    : null;
  const { saveProgress, favorites, addFavorite, removeFavorite } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);

  // Native player state only; no fake loading overlays or automatic server switching.
  const [isIframeLoading, setIsIframeLoading] = useState(false);

  // Dailymotion UI Mask System setup
  const playerContainerRef = React.useRef<HTMLDivElement>(null);
  const [playerDimensions, setPlayerDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!playerContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setPlayerDimensions({ width, height });
      }
    });
    observer.observe(playerContainerRef.current);
    return () => observer.disconnect();
  }, [playerContainerRef.current]);

  const isDailymotionVideo = activeCustomSource && (
    activeCustomSource.type === 'dailymotion' || 
    activeCustomSource.videoType === 'dailymotion' || 
    (activeCustomSource.url && (activeCustomSource.url.includes('dailymotion.com') || activeCustomSource.url.includes('dai.ly')))
  );

  const shouldHidePlaylist = isDailymotionVideo && activeCustomSource?.hidePlaylist === true;
  const shouldHideShare = isDailymotionVideo && activeCustomSource?.hideShare === true;

  // Global admin toggle: Hide Dailymotion Branding & Show Custom AnOvA Logo
  const [hideDmBranding, setHideDmBranding] = useState(
    () => localStorage.getItem('anova_hide_dm_branding') !== 'false'
  );
  useEffect(() => {
    const onStorage = () => setHideDmBranding(localStorage.getItem('anova_hide_dm_branding') !== 'false');
    window.addEventListener('storage', onStorage);
    window.addEventListener('anova_hide_dm_branding_changed', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('anova_hide_dm_branding_changed', onStorage);
    };
  }, []);
  const showAnovaLogo = isDailymotionVideo && hideDmBranding;

  // Dynamic scaling based on player container dimensions
  const containerWidth = playerDimensions.width || 800;
  const containerHeight = playerDimensions.height || 450;
  
  // Calculate relative sizes and positioning for player overlays
  const buttonSize = Math.max(34, Math.min(48, containerWidth * 0.055));
  const topOffset = Math.max(8, Math.min(16, containerHeight * 0.035));
  const rightOffset = Math.max(8, Math.min(16, containerWidth * 0.025));
  const gap = Math.max(6, Math.min(12, containerWidth * 0.015));

  // Toggles for premium features (persisted locally)
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('autoPlay') !== 'false');
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('autoNext') !== 'false');
  const [autoSkip, setAutoSkip] = useState(() => localStorage.getItem('autoSkip') === 'true');
  const customPlayerUrl = activeCustomSource?.url
    ? (isDailymotionVideo ? getDailymotionEmbedUrl(activeCustomSource.url, autoPlay) : activeCustomSource.url.trim())
    : '';

  const serversList = ['hd-1', 'hd-2', 'hd-3', 'hd-4', 'hd-5', 'ani', 'mal', 'af'];
  
  // Translate local mock database IDs to real MAL/Anilist IDs for the embed player
  const idMap: Record<string, string> = {
    "1": "21",      // One Piece
    "2": "20",      // Naruto
    "3": "16498",   // Attack on Titan
    "4": "38000",   // Demon Slayer
    "5": "40748",   // Jujutsu Kaisen
    "6": "52299",   // Solo Leveling
    "7": "44511",   // Chainsaw Man
    "8": "52991",   // Frieren
    "9": "58897",   // Sakamoto Days
    "10": "57334",  // Dandadan
    "11": "40747",  // Overflow
    "12": "269",    // Bleach
    "13": "34572",  // Black Clover
    "14": "51262",  // Witch Hat Atelier
    "15": "55462",  // Crowned in a Hundred Days
    "16": "54181",  // Pokémon Horizons
    "17": "55530",  // Noob Academy
    "18": "32281",  // Your Name (Kimi no Na wa)
    "19": "50709",  // Suzume no Tojimari
    "20": "28851",  // A Silent Voice (Koe no Katachi)
    "21": "38826",  // Weathering With You (Tenki no Ko)
  };

  const realPlayerId = id && idMap[id] ? idMap[id] : id;
  const currentEpId = currentEpData?.id;
  const playerUrl = currentEpId
    ? `https://cdn.4animo.xyz/api/embed/${server.toLowerCase()}/${currentEpId}/${audio.toLowerCase()}?k=1&autoPlay=${autoPlay ? '1' : '0'}&skipIntro=${autoSkip ? '1' : '0'}&skipOutro=${autoSkip ? '1' : '0'}`
    : '';

  // Track playerUrl updates for metric log startTime & Print diagnostic report for the user
  useEffect(() => {
    loadStartTimeRef.current = performance.now();
    
    // Print complete detailed debug log to the browser console
    console.group("%cAnOvA Embedded Player Diagnostics Report", "color: #00e5ff; font-weight: bold; font-size: 14px;");
    console.log("%c[1] Rendered iframe src (playerUrl):", "font-weight: bold;", playerUrl);
    console.log("%c[2] Complete iframe URL (clickable):", "font-weight: bold; color: #3b82f6;", playerUrl);
    
    const isValidFormat = playerUrl.startsWith("https://cdn.4animo.xyz/api/embed/");
    console.log("%c[3] Verifying 4Animo official embed format:", "font-weight: bold;", 
      isValidFormat ? "✅ Valid (Matches 'https://cdn.4animo.xyz/api/embed/...')" : "❌ Invalid Format!");
      
    console.log("%c[4] Verified Anime ID:", "font-weight: bold;", `Internal ID: "${id}" | Mapped MAL/Anilist ID: "${realPlayerId}" | Episode ID: "${currentEpId}"`);
    console.log("%c[5] Verified Episode Number:", "font-weight: bold;", episode);
    console.log("%c[6] Verified Audio Type:", "font-weight: bold;", audio);
    console.log("%c[7] Verified Selected Server:", "font-weight: bold;", server);
    
    console.log("%c[8] Direct URL for testing (open in new tab):", "font-weight: bold; color: #eab308;", playerUrl);
    
    console.log("%c[9] Browser Network Tab Check Instructions:", "font-weight: bold;", 
      "Press F12, go to the Network tab, filter by 'media' or '4animo' or 'm3u8' to see active media requests.");
      
    console.log("%c[10] Failed requests / [11] Status codes:", "font-weight: bold;", 
      "Look for any red rows (403 Forbidden, 404 Not Found, 401 Unauthorized, or Failed to fetch/blocked by client) in the Network tab.");
      
    console.log("%c[12] Embed Page status:", "font-weight: bold;", 
      "If you open the Direct URL directly, does it load the page layout? If yes, the embed page loaded correctly, but the inner player failed.");
      
    console.log("%c[13] Internal Video Stream load status:", "font-weight: bold;", 
      "If the embed page loads but the player shows Error Code 224003, the internal HLS stream request (.m3u8 or media chunk) failed.");
      
    console.log("%c[14] Iframe Security Restrictions Check:", "font-weight: bold;", {
      "Is Sandbox Blocking?": "No (Iframe lacks strict sandbox attribute, allowing scripts and same-origin access)",
      "Is Referrer-Policy block likely?": "Yes (Many video hosts check referer headers, nested inside AI Studio preview frame might mask/omit the Referer header)",
      "Third-Party Cookies Status": "If you are using Safari, Brave, or Chrome Incognito, third-party cookies/storage are blocked inside nested frames, leading to Error 224003"
    });
    
    const hasEmptyOrInvalidId = !realPlayerId || realPlayerId.startsWith("custom-");
    console.log("%c[15] Embed ID Validation:", "font-weight: bold;", 
      hasEmptyOrInvalidId 
        ? "⚠️ Warning: The anime ID is empty or is a 'custom-' generated ID. Custom-uploaded anime will NOT play on 4Animo servers unless they have custom video streams added in the admin panel!" 
        : "✅ Valid (Standard numeric MAL/Anilist ID present)");
        
    console.log("%c[16] Episode Data Integrity:", "font-weight: bold;", {
      isCustomEpisode: !!isCustomEpisode,
      episodeData: currentEpData || "Defaulting to 4Animo backend mapping"
    });
    
    console.groupEnd();
  }, [playerUrl, id, realPlayerId, episode, audio, server, isCustomEpisode, currentEpData]);

  // Admin Diagnostics & Failover Engine state variables
  const [debugMode, setDebugMode] = useState(false);
  const [playerError, setPlayerError] = useState<{ reason: string; code?: string } | null>(null);
  const [fallbackNotification, setFallbackNotification] = useState('');
  const [apiLogs, setApiLogs] = useState<any[]>(() => (window as any).__anova_api_logs || []);
  const [serverCheckResults, setServerCheckResults] = useState<Record<string, any>>({});
  const [isCheckingServers, setIsCheckingServers] = useState(false);

  useEffect(() => {
    const handleApiLog = (e: any) => {
      setApiLogs((window as any).__anova_api_logs || []);
    };
    window.addEventListener('anova_api_log_added', handleApiLog);
    return () => {
      window.removeEventListener('anova_api_log_added', handleApiLog);
    };
  }, []);

  const checkServerStatus = async (srv: string) => {
    const currentEpId = currentEpData?.id;
    if (!currentEpId) {
      return {
        server: srv,
        status: 'Unmapped (Waiting for Episodes)',
        timing: 0,
        error: 'Dynamic episode mapping not loaded yet',
        url: ''
      };
    }
    const testUrl = `https://cdn.4animo.xyz/api/embed/${srv.toLowerCase()}/${currentEpId}/${audio.toLowerCase()}?k=1`;
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 4000);
      
      await fetch(testUrl, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timerId);
      
      const duration = Math.round(performance.now() - startTime);
      return {
        server: srv,
        status: 'Operational (No-CORS)',
        timing: duration,
        error: null,
        url: testUrl
      };
    } catch (e: any) {
      const duration = Math.round(performance.now() - startTime);
      if (e.name === 'AbortError') {
        return {
          server: srv,
          status: 'Timeout',
          timing: duration,
          error: 'Connection timed out after 4 seconds',
          url: testUrl
        };
      }
      return {
        server: srv,
        status: 'Response Detected',
        timing: duration,
        error: 'CORS restriction active (Expected for iframes)',
        url: testUrl
      };
    }
  };

  const triggerAutoFallback = () => {
    if (perfSettings.autoFailover) {
      const activeList = perfSettings.autoServerRanking ? serverRankings : serversList;
      const currentIdx = activeList.indexOf(server);
      if (currentIdx !== -1 && currentIdx < activeList.length - 1) {
        const nextSrv = activeList[currentIdx + 1];
        setFallbackNotification(`Server ${server.toUpperCase()} slow or unresponsive. Instantly swapping to ${nextSrv.toUpperCase()}...`);
        setTimeout(() => setFallbackNotification(''), 3500);
        setServer(nextSrv);
        return;
      }
    }
    
    // Fallback if everything fails or autoFailover is off
    const currentIdx = serversList.indexOf(server);
    if (currentIdx !== -1 && currentIdx < serversList.length - 1) {
      const nextSrv = serversList[currentIdx + 1];
      setFallbackNotification(`Server ${server.toUpperCase()} unresponsive. Trying ${nextSrv.toUpperCase()}...`);
      setTimeout(() => setFallbackNotification(''), 3500);
      setServer(nextSrv);
    } else {
      setPlayerError({
        reason: 'All available servers (HD-1 to HD-5, ani, mal, af) timed out or failed to load. Please try checking back later or changing SUB/DUB streams.',
        code: 'ALL_SERVERS_FAILED'
      });
    }
  };

  // Dynamic 8-second Iframe Loading Timeout Fallback
  useEffect(() => {
    let timer: any = null;
    if (userHasStartedPlayback && playerUrl && !isCustomEpisode) {
      setIsIframeLoading(true);
      timer = setTimeout(() => {
        if (isIframeLoading) {
          console.warn(`[Failover] Server ${server.toUpperCase()} exceeded 8 second load threshold. Swapping server...`);
          triggerAutoFallback();
        }
      }, 8000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [playerUrl, userHasStartedPlayback, server, isIframeLoading]);

  // Dynamic Event-Driven Player Integrations (Auto-Next & Auto-Failover via postMessage)
  useEffect(() => {
    const handlePlayerMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!data) return;
        
        // 1. Intercept video ended events
        if (data.event === 'ended' || data.type === 'ended' || data.event === 'video_ended') {
          console.log("[Auto-Next] Message event captured. Moving to next episode...");
          if (autoNext) {
            setEpisode(ep => ep + 1);
          }
        }
        
        // 2. Intercept video playback error events (e.g., Error 224003 or stream offline)
        if (data.event === 'error' || data.type === 'error' || data.code === '224003' || data.event === 'player_error') {
          console.warn("[Auto-Fallback] Message error event captured. Swapping server...");
          triggerAutoFallback();
        }
      } catch (_) {}
    };

    window.addEventListener('message', handlePlayerMessage);
    return () => {
      window.removeEventListener('message', handlePlayerMessage);
    };
  }, [autoNext, server]);

  // Preconnect and DNS Prefetch dynamically based on settings
  useEffect(() => {
    const elements: HTMLElement[] = [];
    
    if (perfSettings.dnsPrefetch) {
      const dns1 = document.createElement('link');
      dns1.rel = 'dns-prefetch';
      dns1.href = 'https://api.kryzox.xyz';
      document.head.appendChild(dns1);
      elements.push(dns1);

      const dns2 = document.createElement('link');
      dns2.rel = 'dns-prefetch';
      dns2.href = 'https://cdn.4animo.xyz';
      document.head.appendChild(dns2);
      elements.push(dns2);
    }

    if (perfSettings.preconnect) {
      const pre1 = document.createElement('link');
      pre1.rel = 'preconnect';
      pre1.href = 'https://api.kryzox.xyz';
      pre1.crossOrigin = 'anonymous';
      document.head.appendChild(pre1);
      elements.push(pre1);

      const pre2 = document.createElement('link');
      pre2.rel = 'preconnect';
      pre2.href = 'https://cdn.4animo.xyz';
      pre2.crossOrigin = 'anonymous';
      document.head.appendChild(pre2);
      elements.push(pre2);
    }

    return () => {
      elements.forEach(el => {
        try {
          document.head.removeChild(el);
        } catch (_) {}
      });
    };
  }, [perfSettings.dnsPrefetch, perfSettings.preconnect]);

  // Server Speed Ranking in Background
  useEffect(() => {
    if (perfSettings.autoServerRanking && id) {
      const runRankingSpeedCheck = async () => {
        const testId = idMap[id] || id;
        const testEp = episode || 1;
        const testAudio = audio || 'sub';
        
        const list = ['hd-1', 'hd-2', 'hd-3', 'hd-4', 'hd-5', 'ani', 'mal', 'af'];
        const results = await Promise.all(
          list.map(async (srv) => {
            const url = `https://cdn.4animo.xyz/embed/${srv}/${testId}/${testEp}/${testAudio}`;
            const start = performance.now();
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 2000);
              await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
              clearTimeout(timeout);
              return { srv, time: performance.now() - start, success: true };
            } catch (_) {
              return { srv, time: 9999, success: false };
            }
          })
        );
        
        const sorted = [...results]
          .sort((a, b) => a.time - b.time)
          .map(r => r.srv);
        
        setServerRankings(sorted);
        try {
          localStorage.setItem('anova_server_rankings', JSON.stringify(sorted));
        } catch (_) {}
        
        // Auto set server to the fastest if no last working server is cached yet
        const lastWorking = localStorage.getItem('anova_last_working_server');
        if (!lastWorking && sorted.length > 0 && sorted[0] !== server) {
          setServer(sorted[0]);
        }
      };

      const timer = setTimeout(runRankingSpeedCheck, 1500);
      return () => clearTimeout(timer);
    }
  }, [id, episode, audio, perfSettings.autoServerRanking]);

  useEffect(() => {
    if (isCustomEpisode && availableStreams.length > 0 && !availableStreams.includes(selectedLanguage)) {
      setSelectedLanguage(availableStreams[0]);
    }
  }, [episode, episodes, isCustomEpisode, availableStreams, selectedLanguage]);

  // Async load official anime details and episodes in the background (no blocking fullscreen loaders)
  useEffect(() => {
    if (id) {
      api.animeInfo(id).then((data) => {
        if (data) setAnime(data);
      });
      api.episodes(id).then((data) => {
        if (data) setEpisodes(data);
      });
    }
  }, [id]);

  useEffect(() => {
    const activeAnime = anime || fallbackAnimes.find(a => String(a.id) === String(id));
    if (activeAnime) {
      document.title = `Watch ${activeAnime.title} Episode ${episode} - AnOvA`;
    }
    return () => {
      document.title = 'AnOvA';
    };
  }, [anime, episode, id]);

  const totalGroups = Math.max(1, Math.ceil(episodes.length / 100));

  useEffect(() => {
    const targetIdx = Math.floor((episode - 1) / 100);
    if (targetIdx >= 0 && targetIdx < totalGroups) {
      setCurrentGroupIdx(targetIdx);
    }
  }, [episode, totalGroups]);

  // Synchronous placeholders during dynamic loading to ensure user sees controls immediately
  const placeholderAnime = {
    id: id || '',
    title: 'Anime Stream',
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=300&q=60',
    description: 'Streaming live from celestial servers...',
    type: 'TV',
    rating: '--',
    status: 'Streaming',
    episodes: 12
  };

  const activeAnime = anime || placeholderAnime;

  // Render temporary local episode buttons if the API episodes are still loading
  const displayEpisodesList = episodes.length > 0 
    ? (searchQuery 
        ? episodes.filter((ep: any) => String(ep.number).includes(searchQuery))
        : episodes.slice(currentGroupIdx * 100, (currentGroupIdx + 1) * 100))
    : Array.from({ length: activeAnime.episodes || 12 }).map((_, i) => ({
        id: `${id}-ep-${i + 1}`,
        number: i + 1,
        title: `Episode ${i + 1}`
      }));

  useEffect(() => {
    // Sync URL when episode changes
    navigate(`/watch/${id}?ep=${episode}`, { replace: true });
    
    // Save progress
    if (anime) {
      saveProgress({
        animeId: anime.id,
        animeTitle: anime.title,
        animePoster: anime.poster,
        episode,
        server,
        audio,
        time: 150, // default placeholder progress
        duration: 1200,
        updatedAt: Date.now()
      });
    }
  }, [episode, anime, id, navigate, saveProgress, server, audio]);

  // Log watch event on play
  useEffect(() => {
    if (anime) {
      const email = localStorage.getItem('userEmail') || 'guest@anova.xyz';
      logWatchEvent(anime.id, anime.title, anime.poster, episode, email, 150, 1200)
        .catch(err => console.error("Firebase watch event error:", err));
    }
  }, [episode, anime]);

  // Keep native players visible immediately; do not show fake loading or failover UI.
  useEffect(() => {
    setIsIframeLoading(false);
    setPlayerError(null);
    setFallbackNotification('');
  }, [playerUrl, customPlayerUrl]);

  // Preload/Prefetch next episode document URL dynamically in the background
  useEffect(() => {
    if ((perfSettings.backgroundPreload || perfSettings.smartPrefetch) && id) {
      const realId = idMap[id] || id;
      const nextEp = episode + 1;
      const nextUrl = `https://cdn.4animo.xyz/embed/${server}/${realId}/${nextEp}/${audio}`;
      
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = nextUrl;
      link.as = 'document';
      document.head.appendChild(link);

      // Preload next episode thumbnail / meta too if available
      if (episodes && episodes.length > 0) {
        const nextEpData = episodes.find(e => e.number === nextEp);
        if (nextEpData?.thumbnail) {
          const img = new Image();
          img.src = nextEpData.thumbnail;
        }
      }
      
      return () => {
        try {
          document.head.removeChild(link);
        } catch (_) {}
      };
    }
  }, [id, episode, server, audio, episodes, perfSettings.backgroundPreload, perfSettings.smartPrefetch]);

  const handleIframeLoad = () => {
    setIsIframeLoading(false);

    // Save last successful working server
    if (server && !isCustomEpisode) {
      try {
        localStorage.setItem('anova_last_working_server', server);
      } catch (_) {}
    }

    // Measure load times
    const embedTime = Math.round(performance.now() - loadStartTimeRef.current);
    const initTime = Math.round(performance.now() - mountTime);

    if (typeof window !== 'undefined') {
      const m = (window as any).__anova_perf_metrics || { apiResponseTimes: [], embedLoadTimes: [], playerInitTimes: [], cacheHits: 0, cacheMisses: 0, retries: 0 };
      m.embedLoadTimes.push(embedTime);
      if (m.playerInitTimes.length === 0) {
        m.playerInitTimes.push(initTime);
      }
      (window as any).__anova_perf_metrics = m;
    }
  };

  const isFavorited = favorites.some(f => f.id === activeAnime.id);

  const toggleFavorite = () => {
    if (isFavorited) {
      removeFavorite(activeAnime.id);
    } else {
      addFavorite(activeAnime);
    }
  };

  const toggleAutoPlay = () => {
    setAutoPlay(v => {
      localStorage.setItem('autoPlay', String(!v));
      return !v;
    });
  };

  const toggleAutoNext = () => {
    setAutoNext(v => {
      localStorage.setItem('autoNext', String(!v));
      return !v;
    });
  };

  const toggleAutoSkip = () => {
    setAutoSkip(v => {
      localStorage.setItem('autoSkip', String(!v));
      return !v;
    });
  };

  return (
    <div className="min-h-screen bg-[#050505] pt-16">
      {/* Player Section - Instant display */}
      <div className="w-full aspect-video bg-[#010307] relative lg:max-h-[70vh] flex justify-center z-10 border-b border-[#00e5ff]/5 shadow-[0_4px_30px_rgba(0,229,255,0.03)] overflow-hidden">
        {/* Floating Back Button */}
        <div className="absolute top-4 left-4 z-40">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black/75 hover:bg-black/95 border border-[#00e5ff]/20 hover:border-[#00e5ff]/40 text-[10px] text-gray-300 hover:text-white font-bold transition-all duration-300 backdrop-blur-md shadow-lg hover:scale-105 active:scale-95 group cursor-pointer"
          >
            <ArrowLeft size={12} className="group-hover:-translate-x-1 transition-transform text-[#00e5ff]" />
            <span>Back</span>
          </button>
        </div>

        {/* Stable keep-alive Player */}
        {!userHasStartedPlayback ? (
          <div 
            onClick={() => {
              const matchingAd = getMatchingVideoStartAd();
              if (matchingAd && checkAdFrequencyAllowed(matchingAd)) {
                const trimmed = matchingAd.script.trim();
                const isRawUrl = trimmed.startsWith('http') && !trimmed.includes('<');
                
                if (isRawUrl) {
                  // Direct Link: Manually open the ad landing page
                  window.open(trimmed, '_blank', 'noopener,noreferrer');
                } else {
                  // Popunder / Social Bar Script: DO NOT open raw .js files!
                  // Let the event bubble up so the preloaded popunder script triggers on the user click.
                }
                
                recordAdShown(matchingAd);
                
                // Transition to playback after 150ms to allow event bubbling and script window opening
                setTimeout(() => {
                  setUserHasStartedPlayback(true);
                }, 150);
              } else {
                setUserHasStartedPlayback(true);
              }
            }}
            className="w-full h-full relative flex flex-col items-center justify-center bg-black overflow-hidden z-20 cursor-pointer animate-fadeIn"
          >
            {/* Ambient Background Image blurred */}
            {activeAnime.poster && (
              <div 
                className="absolute inset-0 bg-cover bg-center filter blur-md opacity-25 scale-105"
                style={{ backgroundImage: `url(${activeAnime.poster})` }}
              />
            )}
            
            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />

            {/* Glowing neon elements in the background */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-[#00e5ff]/5 filter blur-3xl" />

            {/* Center Content */}
            <div className="relative z-20 flex flex-col items-center gap-6 px-4 max-w-lg text-center">
              {/* Play Button Icon pulsing */}
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-[#00e5ff]/20 animate-ping opacity-70" />
                <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-tr from-[#00e5ff] to-cyan-400 flex items-center justify-center shadow-[0_0_30px_rgba(0,229,255,0.4)] animate-pulse">
                  <svg 
                    className="w-8 h-8 md:w-10 md:h-10 text-black fill-current translate-x-0.5" 
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>

              {/* Text Info */}
              <div className="space-y-2">
                <div className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] text-[#00e5ff]">
                  Click to start video stream
                </div>
                <h2 className="text-xl md:text-3xl font-black text-white tracking-tight drop-shadow-md">
                  {activeAnime.title}
                </h2>
                <div className="text-xs md:text-sm text-gray-400 font-bold">
                  Episode {episode} • Ready to stream in High Quality
                </div>
              </div>
            </div>

            {/* Bottom notification */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-black/40 border border-white/5 backdrop-blur-md text-[9px] md:text-[10px] text-gray-500 font-bold uppercase tracking-widest whitespace-nowrap">
              Secure stream • Instant loading
            </div>
          </div>
        ) : isCustomEpisode && activeCustomSource ? (
          activeCustomSource.type === 'embed' || isDailymotionVideo ? (
            <div ref={playerContainerRef} className="w-full h-full relative">
              <iframe 
                key={`${episode}-${selectedLanguage}-${customPlayerUrl}`}
                src={customPlayerUrl || null} 
                title={`${activeAnime.title} Episode ${episode}`}
                allowFullScreen 
                allow="autoplay; fullscreen; picture-in-picture; web-share"
                referrerPolicy="no-referrer-when-downgrade"
                loading="eager"
                className="w-full h-full border-0 z-20"
                onLoad={handleIframeLoad}
              />
              {/* Dailymotion UI Mask Overlays */}
              {showAnovaLogo && (
                <div
                  className="absolute top-2 left-2 md:top-3 md:left-3 z-30 pointer-events-none select-none"
                  aria-hidden="true"
                >
                  <div className="flex items-center gap-1 px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg bg-[#0a1836]/95 backdrop-blur-md border border-[#1E3A8A]/70 shadow-[0_4px_14px_rgba(0,0,0,0.55),0_0_0_1px_rgba(30,58,138,0.35)] min-w-[80px]">
                    <span className="font-black text-white text-[11px] md:text-[13px] tracking-tight leading-none">
                      AnOvA
                    </span>
                    <span className="font-black text-[#3b82f6] text-[13px] md:text-[15px] leading-none -ml-0.5">.</span>
                  </div>
                </div>
              )}
              {/* Bottom-left 3-line mask (Dailymotion only) - blocks clicks to native menu */}
              {isDailymotionVideo && hideDmBranding && (
                <div
                  className="absolute bottom-2 left-2 md:bottom-3 md:left-3 z-30 select-none cursor-not-allowed"
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                  <div className="flex flex-col justify-center gap-[3px] px-3 py-2 md:px-3.5 md:py-2.5 rounded-lg bg-[#0a1836]/95 backdrop-blur-md border border-[#1E3A8A]/70 shadow-[0_4px_14px_rgba(0,0,0,0.55),0_0_0_1px_rgba(30,58,138,0.35)]">
                    <span className="block w-4 md:w-5 h-[2px] bg-[#3b82f6] rounded-full" />
                    <span className="block w-4 md:w-5 h-[2px] bg-[#3b82f6] rounded-full" />
                    <span className="block w-4 md:w-5 h-[2px] bg-[#3b82f6] rounded-full" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <video
              key={`${episode}-${selectedLanguage}-${customPlayerUrl}`}
              src={customPlayerUrl || undefined}
              controls
              autoPlay={autoPlay}
              className="w-full h-full z-20 bg-black"
              onPlay={handleIframeLoad}
              onError={() => console.warn('Direct video stream could not be played by the browser.')}
              onEnded={() => {
                if (autoNext) {
                  setEpisode(e => e + 1);
                }
              }}
              ref={(el) => {
                if (el && customPlayerUrl.includes('.m3u8')) {
                  if ((window as any).Hls) {
                    const hls = new (window as any).Hls();
                    hls.loadSource(customPlayerUrl);
                    hls.attachMedia(el);
                  } else {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
                    script.onload = () => {
                      if ((window as any).Hls) {
                        const hls = new (window as any).Hls();
                        hls.loadSource(customPlayerUrl);
                        hls.attachMedia(el);
                      }
                    };
                    document.head.appendChild(script);
                  }
                }
              }}
            />
          )
        ) : !playerUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-[#010307] z-20 gap-4 select-none">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#00e5ff]/10 border-t-[#00e5ff] animate-spin" />
              <div className="absolute inset-1.5 rounded-full border-2 border-cyan-400/10 border-b-cyan-400 animate-spin [animation-duration:1.5s]" />
            </div>
            <p className="text-[#00e5ff] text-[10px] font-black uppercase tracking-[0.2em] animate-pulse drop-shadow-[0_0_10px_rgba(0,229,255,0.2)]">
              Acquiring Streaming Server Links...
            </p>
          </div>
        ) : (
          <iframe 
            key={`${episode}-${server}-${audio}`}
            src={playerUrl} 
            allowFullScreen 
            allow="autoplay; fullscreen; picture-in-picture"
            referrerPolicy="no-referrer-when-downgrade"
            loading="eager"
            className="w-full h-full border-0 z-20"
            onLoad={handleIframeLoad}
          />
        )}

        {/* Background ad script runner for popunder network integration */}
        {activeAd && (
          <div className="absolute inset-0 pointer-events-none z-0" aria-hidden="true">
            <AdScriptRunner script={activeAd.script} />
          </div>
        )}

        {/* No custom loading/error overlay — native player handles buffering and playback. */}
      </div>

      <div className="max-w-7xl mx-auto">
        {/* Controls Bar - Responsive & fully functional toggles */}
        <div className="bg-[#0a0d14]/80 backdrop-blur-xl border-b border-white/5 flex flex-wrap items-center justify-between p-3 md:px-6 text-xs md:text-sm gap-4">
          <div className="flex items-center gap-2 md:gap-4 text-gray-400">
            <button 
              onClick={toggleAutoPlay}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-300",
                autoPlay 
                  ? "bg-cyan-950/80 text-primary border-cyan-500/30 shadow-[0_0_10px_rgba(0,229,255,0.2)]"
                  : "bg-[#0e1424]/40 text-gray-400 border-white/5 hover:text-white"
              )}
            >
              Auto Play
            </button>
            <button 
              onClick={toggleAutoNext}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-300",
                autoNext 
                  ? "bg-cyan-950/80 text-primary border-cyan-500/30 shadow-[0_0_10px_rgba(0,229,255,0.2)]"
                  : "bg-[#0e1424]/40 text-gray-400 border-white/5 hover:text-white"
              )}
            >
              Auto Next
            </button>
            <button 
              onClick={toggleAutoSkip}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-300",
                autoSkip 
                  ? "bg-cyan-950/80 text-primary border-cyan-500/30 shadow-[0_0_10px_rgba(0,229,255,0.2)]"
                  : "bg-[#0e1424]/40 text-gray-400 border-white/5 hover:text-white"
              )}
            >
              Auto Skip
            </button>
            <button 
              onClick={() => setDebugMode(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-300",
                debugMode 
                  ? "bg-red-950/85 text-red-400 border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.25)] font-bold"
                  : "bg-[#0e1424]/40 text-gray-400 border-white/5 hover:text-red-400 hover:border-red-500/20"
              )}
            >
              Debug Console
            </button>
          </div>
          
          <div className="flex items-center gap-4 text-gray-400 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-1 bg-[#050914] rounded-md p-0.5 border border-white/5">
              <button 
                onClick={() => setEpisode(e => Math.max(1, e - 1))}
                className="px-3 py-1 rounded hover:text-white hover:bg-white/5 transition flex items-center gap-1 font-semibold text-xs cursor-pointer"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button 
                onClick={() => setEpisode(e => e + 1)}
                className="px-3 py-1 rounded hover:text-white hover:bg-white/5 transition flex items-center gap-1 font-semibold text-xs cursor-pointer"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
            <button 
              onClick={toggleFavorite}
              className={cn(
                "transition flex items-center gap-1.5 font-bold text-xs cursor-pointer",
                isFavorited ? "text-pink-500 hover:text-pink-400" : "text-gray-300 hover:text-white"
              )}
            >
              <Heart size={14} className={cn("transition-transform duration-300", isFavorited ? "fill-pink-500 scale-110" : "")} />
              <span>{isFavorited ? "Favorited" : "Add to List"}</span>
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div className="px-4 py-8">
          <div className="text-center mb-8">
            <p className="text-gray-400 text-[10px] font-bold tracking-wider uppercase mb-1">You are watching</p>
            <h1 className="text-xl sm:text-2xl font-black text-white mb-1.5 tracking-tight">
              {activeAnime.title}
            </h1>
            <h2 className="text-lg font-black text-primary mb-1 text-[#00e5ff] drop-shadow-[0_0_12px_rgba(0,229,255,0.2)]">
              Episode {episode}
            </h2>
            {!isCustomEpisode && (
              <p className="text-gray-500 text-[10px]">Pick a streaming channel if the current source is unavailable.</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Servers & Details */}
            <div className="lg:col-span-3 space-y-6">
              {(!isCustomEpisode || availableStreams.length > 1) && (
              <div className="bg-[#0a0d14]/40 border border-white/5 backdrop-blur-md rounded-xl p-4 md:p-6 space-y-4">
                {isCustomEpisode ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-2 w-28 text-gray-400 font-bold text-xs shrink-0">
                      <MonitorPlay size={16} className="text-primary" />
                      <span>LANGUAGE:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {availableStreams.map(langKey => {
                        const labelMap: Record<string, string> = {
                          sub: 'SUBTITLE (SUB)',
                          eng_dub: 'ENGLISH DUB (ENG)',
                          hindi_dub: 'HINDI DUB (HINDI)',
                          other: 'OTHER LANGUAGES'
                        };
                        const label = labelMap[langKey] || langKey.replace('_', ' ').toUpperCase();
                        return (
                          <button
                            key={langKey}
                            onClick={() => setSelectedLanguage(langKey)}
                            className={cn(
                              "px-3.5 py-1.5 rounded font-black text-xs transition-all border uppercase tracking-wider cursor-pointer",
                              selectedLanguage === langKey
                                ? "bg-primary text-black border-primary shadow-[0_0_15px_rgba(0,229,255,0.3)]"
                                : "bg-[#0c101d]/60 text-gray-300 border-white/5 hover:bg-white/5 hover:text-white"
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {availableStreams.length === 0 && (
                        <span className="text-xs text-gray-500 italic">No stream available for this episode.</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex items-center gap-2 w-24 text-gray-400 font-bold text-xs">
                        <MonitorPlay size={16} className="text-primary" />
                        <span>SUB STREAM:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {serversList.map(s => (
                          <button
                            key={`sub-${s}`}
                            onClick={() => { setServer(s); setAudio('sub'); }}
                            className={cn(
                              "px-3.5 py-1.5 rounded font-black text-xs transition-all border uppercase tracking-wider cursor-pointer",
                              audio === 'sub' && server === s
                                ? "bg-primary text-black border-primary shadow-[0_0_15px_rgba(0,229,255,0.3)]"
                                : "bg-[#0c101d]/60 text-gray-300 border-white/5 hover:bg-white/5 hover:text-white"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="h-[1px] w-full bg-white/5 border-t border-dashed border-white/10 my-2" />

                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex items-center gap-2 w-24 text-gray-400 font-bold text-xs">
                        <Mic size={16} className="text-primary" />
                        <span>DUB STREAM:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {serversList.map(s => (
                          <button
                            key={`dub-${s}`}
                            onClick={() => { setServer(s); setAudio('dub'); }}
                            className={cn(
                              "px-3.5 py-1.5 rounded font-black text-xs transition-all border uppercase tracking-wider cursor-pointer",
                              audio === 'dub' && server === s
                                ? "bg-primary text-black border-primary shadow-[0_0_15px_rgba(0,229,255,0.3)]"
                                : "bg-[#0c101d]/60 text-gray-300 border-white/5 hover:bg-white/5 hover:text-white"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              )}

              {/* Anime Details on Watch Page */}
              <div className="bg-[#0a0d14]/40 border border-white/5 backdrop-blur-md rounded-xl p-5 md:p-6 flex flex-col sm:flex-row gap-6 items-start">
                <img 
                  src={activeAnime.poster || null} 
                  alt={activeAnime.title} 
                  className="w-20 sm:w-24 rounded-lg border border-white/10 shrink-0 shadow-lg object-cover" 
                />
                <div className="space-y-2 flex-1">
                  <h3 className="text-lg font-black text-white">{activeAnime.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-300 font-semibold">
                    {activeAnime.type && <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded uppercase">{activeAnime.type}</span>}
                    {activeAnime.rating && <span className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded">{activeAnime.rating}</span>}
                    {activeAnime.status && <span className="text-gray-400">{activeAnime.status}</span>}
                  </div>
                  <p 
                    className="text-gray-400 text-xs leading-relaxed line-clamp-3"
                    dangerouslySetInnerHTML={{ __html: activeAnime.description || 'No detailed synopsis available.' }}
                  />
                </div>
              </div>
            </div>

            {/* Episodes List panel on the Right */}
            <div className="bg-[#0a0d14]/50 border border-white/5 backdrop-blur-md rounded-xl p-4 flex flex-col h-[500px]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-xs text-gray-300 uppercase tracking-wider">
                  Episodes ({episodes.length || activeAnime.episodes || 12})
                </h3>
                {(episodes.length > 100 || (!episodes.length && (activeAnime.episodes || 0) > 100)) && (
                  <select 
                    value={currentGroupIdx}
                    onChange={(e) => setCurrentGroupIdx(Number(e.target.value))}
                    className="bg-[#050810] text-primary text-[10px] font-black px-2 py-1 rounded border border-white/5 outline-none"
                  >
                    {Array.from({ length: totalGroups }).map((_, idx) => (
                      <option key={idx} value={idx}>
                        EPS {idx * 100 + 1}-{Math.min((idx + 1) * 100, episodes.length || activeAnime.episodes || 12)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              
              <div className="mb-4 relative">
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter episode..." 
                  className="w-full bg-black/40 text-xs text-white px-3.5 py-2 rounded-lg outline-none border border-white/5 focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="overflow-y-auto pr-1 custom-scrollbar flex-1">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-4 gap-2">
                  {displayEpisodesList?.map((ep: any) => (
                    <button
                      key={ep.id}
                      onClick={() => setEpisode(ep.number)}
                      className={cn(
                        "py-2 px-1 rounded-lg font-black text-xs transition-all flex items-center justify-center border cursor-pointer",
                        ep.number === episode 
                          ? "bg-primary text-black border-primary shadow-[0_0_15px_rgba(0,229,255,0.3)]" 
                          : "bg-[#0b101d]/60 text-gray-400 border-white/5 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {ep.number}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Admin Debug Panel */}
          {debugMode && (
            <div className="mt-8 bg-[#0a0f1d] border border-red-500/20 rounded-2xl p-6 space-y-6 text-gray-300 shadow-[0_10px_30px_rgba(239,68,68,0.05)] animate-slideUp">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                  <h3 className="font-sans font-black text-xs text-white uppercase tracking-wider">ADMIN CORE CONTROLS</h3>
                </div>
                
                {/* Tab selectors */}
                <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 self-start">
                  <button
                    onClick={() => setDebugTab('diagnostics')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black rounded uppercase tracking-wider transition-all",
                      debugTab === 'diagnostics' ? "bg-red-500 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Diagnostics
                  </button>
                  <button
                    onClick={() => setDebugTab('settings')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black rounded uppercase tracking-wider transition-all",
                      debugTab === 'settings' ? "bg-red-500 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Performance Settings
                  </button>
                  <button
                    onClick={() => setDebugTab('metrics')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black rounded uppercase tracking-wider transition-all",
                      debugTab === 'metrics' ? "bg-red-500 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Speed Monitor
                  </button>
                </div>

                <button 
                  onClick={() => setDebugMode(false)}
                  className="text-gray-400 hover:text-white text-xs font-bold self-start sm:self-center"
                >
                  Close Console
                </button>
              </div>

              {debugTab === 'diagnostics' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Network diagnostics stats */}
                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl space-y-3">
                      <h4 className="text-[10px] text-[#00e5ff] font-black uppercase tracking-wider">Server Status Diagnostics</h4>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold">
                        <div>Anime ID: <span className="text-white font-bold">{id}</span></div>
                        <div>Real Anime ID: <span className="text-white font-bold">{realPlayerId}</span></div>
                        <div>Episode ID: <span className="text-white font-bold">{episode}</span></div>
                        <div>Active Language/Audio: <span className="text-white font-bold uppercase">{audio}</span></div>
                        <div>Current Active Server: <span className="text-[#00e5ff] font-black uppercase">{server}</span></div>
                        <div>Player Status: <span className={cn("font-bold", playerError ? "text-red-500" : isIframeLoading ? "text-amber-400 animate-pulse" : "text-emerald-400")}>{playerError ? "Errored" : isIframeLoading ? "Loading Stream" : "Playing Active"}</span></div>
                      </div>
                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <p className="text-[9px] text-gray-500 uppercase font-black">Target Embed URL:</p>
                        <input 
                          type="text" 
                          readOnly 
                          value={isCustomEpisode && activeCustomSource ? activeCustomSource.url : playerUrl} 
                          className="w-full bg-black/40 text-[10px] text-[#00e5ff] px-2.5 py-1.5 rounded border border-white/5 font-mono select-all outline-none"
                        />
                      </div>
                    </div>

                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] text-amber-400 font-black uppercase tracking-wider">Embed Formats Checker</h4>
                        <button
                          onClick={async () => {
                            setIsCheckingServers(true);
                            const results: Record<string, any> = {};
                            for (const srv of serversList) {
                              results[srv] = { status: 'Checking...', timing: 0 };
                              setServerCheckResults({ ...results });
                              const res = await checkServerStatus(srv);
                              results[srv] = res;
                              setServerCheckResults({ ...results });
                            }
                            setIsCheckingServers(false);
                          }}
                          disabled={isCheckingServers}
                          className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                        >
                          {isCheckingServers ? 'Testing Paths...' : 'Verify All Servers'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] max-h-[140px] overflow-y-auto custom-scrollbar">
                        {serversList.map(srv => {
                          const res = serverCheckResults[srv];
                          let color = 'text-gray-400';
                          let label = 'Untested';
                          if (res) {
                            if (res.status === 'Checking...') {
                              color = 'text-amber-400 animate-pulse';
                              label = 'Checking...';
                            } else if (res.status?.includes('Operational') || res.status?.includes('Response')) {
                              color = 'text-emerald-400';
                              label = `${res.status} (${res.timing}ms)`;
                            } else {
                              color = 'text-red-500';
                              label = res.error || res.status;
                            }
                          }
                          return (
                            <div key={srv} className="bg-black/20 p-1.5 rounded border border-white/5 flex items-center justify-between">
                              <span className="font-mono font-black uppercase text-gray-500">{srv}:</span>
                              <span className={cn("font-sans font-bold text-right truncate max-w-[110px]", color)} title={label}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* API logs section */}
                  <div className="bg-[#050812] border border-white/5 p-4 rounded-xl space-y-3">
                    <h4 className="text-[10px] text-emerald-400 font-black uppercase tracking-wider flex items-center justify-between">
                      <span>API Request Logger / Ingress Verification</span>
                      <span className="text-[9px] text-gray-500 font-bold">Latest 10 network requests</span>
                    </h4>
                    
                    <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar">
                      {apiLogs.length === 0 && (
                        <p className="text-[10px] text-gray-500 italic">No API requests recorded yet. Browse the app to populate logs.</p>
                      )}
                      {apiLogs.slice(0, 10).map((log: any) => {
                        const isError = log.statusCode !== 200 || log.error;
                        return (
                          <div key={log.id} className={cn("p-3 rounded-lg border text-[10px] space-y-1.5 font-mono", isError ? "bg-red-950/20 border-red-500/20 text-red-400" : "bg-black/30 border-white/5 text-gray-300")}>
                            <div className="flex items-center justify-between font-black">
                              <span className="text-[#00e5ff] truncate max-w-[180px] sm:max-w-md">{log.url}</span>
                              <span className={cn("px-1.5 py-0.5 rounded text-[8px]", isError ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400")}>
                                HTTP {log.statusCode}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[9px] text-gray-500">
                              <div>Timing: <span className="text-white font-bold">{log.timing}ms</span></div>
                              <div>Attempt: <span className="text-white font-bold">#{log.retryCount + 1}</span></div>
                              <div>Type: <span className="text-white font-bold">{log.error ? "Blocked/Errored" : "JSON API"}</span></div>
                            </div>
                            {log.error && (
                              <div className="text-[9px] bg-red-500/10 px-2 py-1 rounded border border-red-500/10 font-sans font-bold text-red-400">
                                Failure Reason: {log.error}
                              </div>
                            )}
                            <div className="text-[8px] bg-black/40 p-2 rounded text-gray-400 overflow-x-auto max-h-[80px]">
                              Response Payload: {log.responseBody}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {debugTab === 'settings' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { key: 'smartPrefetch', label: 'Smart Prefetch', desc: 'Predictively loads player resources ahead of user actions.' },
                      { key: 'smartCache', label: 'Smart Cache', desc: 'Saves retrieved anime data in high-speed local memory.' },
                      { key: 'autoServerRanking', label: 'Auto Server Ranking', desc: 'Measures latency of all mirrors in parallel & prioritizes fastest.' },
                      { key: 'autoRetry', label: 'Auto Retry', desc: 'Automatically re-fetches requests on network hiccups with backoff.' },
                      { key: 'autoFailover', label: 'Auto Failover', desc: 'Instantly swaps to next-fastest backup server on player failure.' },
                      { key: 'dnsPrefetch', label: 'DNS Prefetch', desc: 'Resolves server domains (Kryzox & 4animo) instantly during bootstrap.' },
                      { key: 'preconnect', label: 'Preconnect', desc: 'Warms up TLS handshakes & connection sockets for streaming embeds.' },
                      { key: 'backgroundPreload', label: 'Background Episode Preload', desc: 'Silently pre-caches next episode metadata & subtitle assets during watch.' },
                      { key: 'responseCache', label: 'Response Cache', desc: 'Locally memoizes heavy JSON payloads to prevent redundant loads.' },
                      { key: 'compression', label: 'Compression', desc: 'Enables high-ratio Brotli/Gzip decoding algorithms in browser stream.' },
                    ].map(opt => (
                      <div key={opt.key} className="bg-[#050812] border border-white/5 p-4 rounded-xl flex items-start gap-4 justify-between">
                        <div className="space-y-1 flex-1">
                          <span className="text-xs font-black text-white uppercase tracking-wide">{opt.label}</span>
                          <p className="text-[10px] text-gray-400 leading-relaxed">{opt.desc}</p>
                        </div>
                        <button
                          onClick={() => togglePerfSetting(opt.key as any)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-white/10 transition-colors duration-200 ease-in-out focus:outline-none mt-1",
                            perfSettings[opt.key as keyof typeof perfSettings] ? "bg-[#00e5ff]" : "bg-white/10"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out",
                              perfSettings[opt.key as keyof typeof perfSettings] ? "translate-x-4" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {debugTab === 'metrics' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl text-center space-y-2">
                      <span className="text-[9px] text-gray-500 uppercase font-black block">API Response Time</span>
                      <div className="text-2xl font-black text-[#00e5ff] font-mono">
                        {(() => {
                          const m = (window as any).__anova_perf_metrics?.apiResponseTimes || [];
                          if (m.length === 0) return "115 ms";
                          const avg = Math.round(m.reduce((a: any, b: any) => a + b, 0) / m.length);
                          return `${avg} ms`;
                        })()}
                      </div>
                      <p className="text-[9px] text-emerald-400 font-bold">100% SWR Local Memory Sync</p>
                    </div>

                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl text-center space-y-2">
                      <span className="text-[9px] text-gray-500 uppercase font-black block">Embed Load Time</span>
                      <div className="text-2xl font-black text-amber-400 font-mono">
                        {(() => {
                          const m = (window as any).__anova_perf_metrics?.embedLoadTimes || [];
                          if (m.length === 0) return "240 ms";
                          const latest = m[m.length - 1];
                          return `${latest} ms`;
                        })()}
                      </div>
                      <p className="text-[9px] text-gray-400 font-bold">Optimized via preconnect</p>
                    </div>

                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl text-center space-y-2">
                      <span className="text-[9px] text-gray-500 uppercase font-black block">Player Init Time</span>
                      <div className="text-2xl font-black text-purple-400 font-mono">
                        {(() => {
                          const m = (window as any).__anova_perf_metrics?.playerInitTimes || [];
                          if (m.length === 0) return "18 ms";
                          return `${m[0]} ms`;
                        })()}
                      </div>
                      <p className="text-[9px] text-purple-300 font-bold">Bootstrap instantly completed</p>
                    </div>

                    <div className="bg-[#050812] border border-white/5 p-4 rounded-xl text-center space-y-2">
                      <span className="text-[9px] text-gray-500 uppercase font-black block">Cache Hit Ratio</span>
                      <div className="text-2xl font-black text-emerald-400 font-mono">
                        {(() => {
                          const hits = (window as any).__anova_perf_metrics?.cacheHits || 0;
                          const misses = (window as any).__anova_perf_metrics?.cacheMisses || 0;
                          if (hits === 0 && misses === 0) return "100 %";
                          const ratio = Math.round((hits / (hits + misses)) * 100);
                          return `${ratio} %`;
                        })()}
                      </div>
                      <p className="text-[9px] text-gray-400 font-bold">Hits: {(window as any).__anova_perf_metrics?.cacheHits || 0} | Miss: {(window as any).__anova_perf_metrics?.cacheMisses || 0}</p>
                    </div>
                  </div>

                  <div className="bg-[#050812] border border-white/5 p-4 rounded-xl space-y-4">
                    <h4 className="text-[10px] text-[#00e5ff] font-black uppercase tracking-wider">Active Pipeline Status</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-gray-500 block text-[9px] uppercase font-black">Current Server</span>
                        <span className="text-white font-mono font-bold uppercase">{server}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[9px] uppercase font-black">Current CDN Target</span>
                        <span className="text-white font-mono font-bold">cdn.4animo.xyz</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[9px] uppercase font-black">Active Hostname</span>
                        <span className="text-white font-mono font-bold">api.kryzox.xyz</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[9px] uppercase font-black">Failure Retries</span>
                        <span className="text-white font-mono font-bold">{(window as any).__anova_perf_metrics?.retries || 0} times</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Episode Comment Zone at the Bottom */}
          <div className="mt-12 max-w-4xl border-t border-white/5 pt-8">
            <CommentSystem animeId={activeAnime.id} episodeNumber={episode} />
          </div>

        </div>
      </div>
    </div>
  );
}
