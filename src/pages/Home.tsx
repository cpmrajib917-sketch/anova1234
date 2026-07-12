// @ts-nocheck
import React, { useEffect, useState, useRef } from 'react';
import { Anime } from '../types';
import { HeroBanner } from '../components/HeroBanner';
import { EstimatedSchedule } from '../components/EstimatedSchedule';
import { Top10Ranked } from '../components/Top10Ranked';
import { AnimeCard } from '../components/AnimeCard';
import { api, apiCache } from '../lib/api';
import { useAppStore } from '../store';
import { Play, RotateCcw, ChevronLeft, ChevronRight, Sparkles, Flame, Eye, Film, Grid, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HeroBannerSkeleton, Top10RankedSkeleton } from '../components/Skeletons';

const mapAnime = (a: any) => ({
  ...a,
  id: String(a.id),
  poster: a.images?.poster || a.poster,
  banner: a.images?.banner || a.banner || a.images?.poster || a.poster,
  title: a.titles?.english || a.titles?.romaji || a.title
});

// Configure standard 4Animo categories
const CATEGORIES_CONFIG = [
  { id: 'trending', title: '🔥 Trending Anime', link: '/search?sort=popularity', fetch: () => api.search('', 1, { sort: 'popularity' }) },
  { id: 'latest', title: '🆕 Latest Episodes', link: '/search?sort=latest', fetch: () => api.updated() },
  { id: 'popular', title: '⭐ Popular Anime', link: '/search?sort=popularity', fetch: () => api.popular() },
  { id: 'ongoing', title: '📺 Ongoing Anime', link: '/search?status=RELEASING', fetch: () => api.search('', 1, { status: 'RELEASING' }) },
  { id: 'completed', title: '✅ Completed Anime', link: '/search?status=FINISHED', fetch: () => api.search('', 1, { status: 'FINISHED' }) },
  { id: 'movies', title: '🎬 Movies', link: '/search?type=MOVIE', fetch: () => api.search('', 1, { type: 'MOVIE' }) },
  { id: 'romance', title: '🌸 Romance', link: '/search?genre=Romance', fetch: () => api.search('Romance', 1) },
  { id: 'action', title: '⚔ Action', link: '/search?genre=Action', fetch: () => api.search('Action', 1) },
  { id: 'comedy', title: '😂 Comedy', link: '/search?genre=Comedy', fetch: () => api.search('Comedy', 1) },
  { id: 'horror', title: '👻 Horror', link: '/search?genre=Horror', fetch: () => api.search('Horror', 1) },
  { id: 'fantasy', title: '✨ Fantasy', link: '/search?genre=Fantasy', fetch: () => api.search('Fantasy', 1) },
  { id: 'scifi', title: '🚀 Sci-Fi', link: '/search?genre=Sci-Fi', fetch: () => api.search('Sci-Fi', 1) },
  { id: 'school', title: '🏫 School', link: '/search?genre=School', fetch: () => api.search('School', 1) },
  { id: 'isekai', title: '🌎 Isekai', link: '/search?genre=Isekai', fetch: () => api.search('Isekai', 1) },
  { id: 'shounen', title: '👊 Shounen', link: '/search?genre=Shounen', fetch: () => api.search('Shounen', 1) },
  { id: 'sliceoflife', title: '💖 Slice of Life', link: '/search?genre=Slice%20of%20Life', fetch: () => api.search('Slice of Life', 1) },
  { id: 'drama', title: '🎭 Drama', link: '/search?genre=Drama', fetch: () => api.search('Drama', 1) },
  { id: 'mystery', title: '🕵 Mystery', link: '/search?genre=Mystery', fetch: () => api.search('Mystery', 1) },
  { id: 'music', title: '🎵 Music', link: '/search?genre=Music', fetch: () => api.search('Music', 1) },
  { id: 'kids', title: '👦 Kids', link: '/search?genre=Kids', fetch: () => api.search('Kids', 1) },
];

export function LazyCategorySection({ id, title, link, fetchFn, alreadyShownIds, onDataLoaded }: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loaded && !loading) {
          loadData();
        }
      },
      { rootMargin: '300px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [loaded, loading]);

  const loadData = async () => {
    setLoading(true);
    try {
      const cacheKey = `home_section_data_${id}`;
      let items = apiCache.get(cacheKey);
      if (!items) {
        const res = await fetchFn();
        items = Array.isArray(res) ? res : (res?.data || []);
        apiCache.set(cacheKey, items);
      }
      
      const mapped = items.map(mapAnime);
      const unique = Array.from(new Map(mapped.map((item: any) => [item.id, item])).values()) as Anime[];
      
      // Filter out duplicate anime across categories whenever possible
      let filtered = unique.filter((a: Anime) => !alreadyShownIds.has(String(a.id)));
      if (filtered.length < 6) {
        filtered = unique; // Fallback to keep density high
      }
      
      setData(filtered.slice(0, 18));
      onDataLoaded(filtered.map((a: Anime) => String(a.id)));
      setLoaded(true);
    } catch (e) {
      console.error(`Failed to load category section ${title}:`, e);
    } finally {
      setLoading(false);
    }
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftArrow(scrollLeft > 10);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const amount = clientWidth * 0.75;
      scrollRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - amount : scrollLeft + amount,
        behavior: 'smooth'
      });
    }
  };

  if (!loading && loaded && data.length === 0) return null;

  return (
    <div ref={containerRef} className="py-4 border-b border-white/5 relative group">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm md:text-base font-black text-white tracking-tight flex items-center gap-1.5 uppercase">
          <span className="w-1 h-4 bg-primary rounded-full shadow-[0_0_10px_rgba(0,229,255,0.8)] animate-pulse" />
          {title}
        </h2>
        <Link 
          to={link}
          className="text-[10px] md:text-xs text-[#00e5ff] hover:text-cyan-400 font-extrabold uppercase tracking-widest transition-colors flex items-center gap-1"
        >
          <span>View All</span>
          <ArrowRight size={12} />
        </Link>
      </div>

      {loading ? (
        <div className="flex gap-2 pb-2 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <div 
              key={i} 
              className="w-[120px] sm:w-[145px] md:w-[165px] lg:w-[175px] xl:w-[185px] shrink-0 animate-pulse bg-card/30 border border-white/5 rounded-xl aspect-[9/14]" 
            />
          ))}
        </div>
      ) : (
        <div className="relative">
          {/* Scroll Buttons visible on hover */}
          {showLeftArrow && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 z-30 bg-black/80 hover:bg-[#00e5ff] text-white hover:text-black p-2 rounded-full border border-white/10 hover:border-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-[0_0_15px_rgba(0,0,0,0.6)] cursor-pointer"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {showRightArrow && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 z-30 bg-black/80 hover:bg-[#00e5ff] text-white hover:text-black p-2 rounded-full border border-white/10 hover:border-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-[0_0_15px_rgba(0,0,0,0.6)] cursor-pointer"
            >
              <ChevronRight size={18} />
            </button>
          )}

          {/* Horizontally scrollable list */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-none snap-x snap-mandatory scroll-smooth pb-2"
          >
            {data.map((anime) => (
              <div
                key={anime.id}
                className="w-[120px] sm:w-[145px] md:w-[165px] lg:w-[175px] xl:w-[185px] shrink-0 snap-start"
              >
                <AnimeCard anime={anime} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Home() {
  const [loading, setLoading] = useState(true);
  const [trending, setTrending] = useState<Anime[]>([]);
  const [top10, setTop10] = useState<Anime[]>([]);
  const [alreadyShownIds, setAlreadyShownIds] = useState<Set<string>>(new Set());
  const [customSections, setCustomSections] = useState<any[]>([]);

  // Infinite Catalog States
  const [catalogItems, setCatalogItems] = useState<Anime[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [hasMoreCatalog, setHasMoreCatalog] = useState(true);

  const catalogPageRef = useRef(1);
  const isFetchingRef = useRef(false);
  const catalogShownIdsRef = useRef<Set<string>>(new Set());

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Sync watchlist / continue watching
  const { watchHistory } = useAppStore();
  const continueWatchingList = Object.values(watchHistory || {})
    .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
    .slice(0, 6);

  // Handle category loaded items to avoid duplicate cards on homepage
  const handleDataLoaded = (ids: string[]) => {
    setAlreadyShownIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  };

  // 1. Initial Spotlight & Custom/API Section Configuration Fetcher
  useEffect(() => {
    let active = true;
    
    const loadHeroAndMeta = async () => {
      try {
        const homeData = await api.home(true);
        if (active && homeData) {
          const trendList = (homeData.data?.trending || []).map(mapAnime);
          setTrending(trendList);

          const popular = (homeData.data?.mostPopular || []).map(mapAnime);
          setTop10(popular.slice(0, 10));

          // Load custom dynamic sections from Firebase/Admin
          if (homeData.dynamicSections) {
            const standardSlugs = new Set(CATEGORIES_CONFIG.map(c => c.id));
            const filteredCustom = homeData.dynamicSections.filter(
              (sec: any) => sec.status === 'active' && sec.visible !== false && !standardSlugs.has(sec.slug)
            );
            setCustomSections(filteredCustom);
          }
        }
      } catch (e) {
        console.error("Failed to load hero banner spotlight:", e);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadHeroAndMeta();
    return () => { active = false; };
  }, []);

  // 2. Main Explore Paginated Catalog Fetcher (Load More / Infinite Scroll)
  const loadNextCatalogPage = async () => {
    if (isFetchingRef.current || !hasMoreCatalog) return;
    isFetchingRef.current = true;
    setCatalogLoading(true);
    
    const pageToFetch = catalogPageRef.current;
    try {
      // api.search handles page 1 containing pinned/manual anime first, then API anime
      // and page 2+ containing only the API results with full duplicate prevention!
      const res = await api.search('', pageToFetch);
      if (res && res.data) {
        const mapped = res.data.map(mapAnime);
        
        // Prevent duplicate cards globally in the bottom catalog
        const uniqueIncoming = mapped.filter((item: Anime) => {
          const idStr = String(item.id);
          if (catalogShownIdsRef.current.has(idStr)) return false;
          return true;
        });

        if (uniqueIncoming.length > 0) {
          // Synchronously record these IDs immediately to prevent any race condition from overlapping triggers
          uniqueIncoming.forEach((x: Anime) => catalogShownIdsRef.current.add(String(x.id)));
          
          setCatalogItems(prev => [...prev, ...uniqueIncoming]);
          catalogPageRef.current = pageToFetch + 1;
        } else if (mapped.length === 0) {
          setHasMoreCatalog(false);
        } else {
          // If every item returned was a duplicate, increment page and continue trying once automatically
          catalogPageRef.current = pageToFetch + 1;
        }

        if (res.page >= res.pages || mapped.length === 0) {
          setHasMoreCatalog(false);
        }
      } else {
        setHasMoreCatalog(false);
      }
    } catch (e) {
      console.error("Failed to fetch next catalog page:", e);
    } finally {
      isFetchingRef.current = false;
      setCatalogLoading(false);
    }
  };

  // Trigger Infinite scroll when sentinel in view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isFetchingRef.current && hasMoreCatalog) {
        loadNextCatalogPage();
      }
    }, { rootMargin: '400px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCatalog]);

  if (loading && trending.length === 0) {
    return (
      <div className="pb-24 min-h-screen bg-[#050505]">
        <HeroBannerSkeleton />
        <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-6 mt-4">
          <Top10RankedSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24 min-h-screen bg-[#050505]">
      {/* Cinematic Hero Spotlight Carousel */}
      <HeroBanner trending={trending.length > 0 ? trending : top10} />
      
      {/* Main Container - Space-optimized layout */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-1 mt-4 relative z-10">
        
        {/* CONTINUE WATCHING - Displays if watch history contains data */}
        {continueWatchingList.length > 0 && (
          <div className="py-4 border-b border-white/5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm md:text-base font-black text-white tracking-tight flex items-center gap-1.5 uppercase">
                <RotateCcw size={14} className="text-primary animate-spin-[reverse] duration-1000" />
                Continue Watching
              </h2>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {continueWatchingList.map((item: any) => (
                <Link 
                  key={item.animeId} 
                  to={`/watch/${item.animeId}?ep=${item.episode}`}
                  className="flex gap-3 bg-[#0a0d14]/80 p-2 rounded-xl border border-white/5 hover:border-primary/50 transition-all duration-300 group hover:shadow-[0_0_15px_rgba(0,229,255,0.08)]"
                >
                  <div className="w-14 h-20 relative overflow-hidden rounded-lg shrink-0">
                    <img src={item.animePoster || null} alt={item.animeTitle} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play fill="white" size={14} className="text-white" />
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <h3 className="font-extrabold text-xs text-gray-200 line-clamp-1 group-hover:text-primary transition-colors">{item.animeTitle}</h3>
                      <p className="text-[10px] text-gray-400 mt-0.5">Episode {item.episode}</p>
                    </div>
                    <div className="w-full bg-[#10141f] rounded-full h-1">
                      <div 
                        className="bg-primary h-1 rounded-full shadow-[0_0_8px_rgba(0,229,255,0.8)]" 
                        style={{ width: item.duration > 0 ? `${(item.time / item.duration) * 100}%` : '40%' }}
                      />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* TOP 10 TODAY (Netflix Ranked Design) */}
        <Top10Ranked animes={top10} />

        {/* 20+ LAZY-LOADED CATEGORY TRACKS */}
        <div className="space-y-2">
          {CATEGORIES_CONFIG.map((cat) => (
            <LazyCategorySection
              key={cat.id}
              id={cat.id}
              title={cat.title}
              link={cat.link}
              fetchFn={cat.fetch}
              alreadyShownIds={alreadyShownIds}
              onDataLoaded={handleDataLoaded}
            />
          ))}

          {/* Automatically support new custom categories added dynamically by the API */}
          {customSections.map((sec) => (
            <LazyCategorySection
              key={sec.slug}
              id={sec.slug}
              title={`✨ ${sec.name}`}
              link={`/search?q=${encodeURIComponent(sec.name)}`}
              fetchFn={async () => sec.animes || []}
              alreadyShownIds={alreadyShownIds}
              onDataLoaded={handleDataLoaded}
            />
          ))}
        </div>

        {/* ESTIMATED BROADCAST SCHEDULE */}
        <div className="pt-4 border-t border-white/5">
          <EstimatedSchedule />
        </div>

        {/* MAIN PAGINATED CATALOG GRID */}
        <div className="pt-8 mt-8 border-t border-white/5">
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-1">
            <div>
              <h2 className="text-base md:text-lg font-black text-white tracking-tight flex items-center gap-2 uppercase">
                <Grid size={16} className="text-[#00e5ff]" />
                Explore All Anime
              </h2>
              <p className="text-[10px] text-gray-500 font-extrabold uppercase tracking-widest mt-0.5">
                Dynamic continuous scroll • Pinned animes featured first
              </p>
            </div>
          </div>

          {/* High-density grid with exact 4Animo specifications */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2.5 sm:gap-3">
            {catalogItems.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </div>

          {/* Loading sentinel and indicators */}
          <div ref={sentinelRef} className="pt-8 pb-4 flex flex-col items-center justify-center gap-3">
            {catalogLoading && (
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <div className="relative w-8 h-8">
                  <div className="absolute inset-0 rounded-full border-2 border-[#00e5ff]/10 border-t-[#00e5ff] animate-spin" />
                </div>
                <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Loading Next Page...</p>
              </div>
            )}

            {!hasMoreCatalog && catalogItems.length > 0 && (
              <p className="text-gray-600 text-[10px] font-extrabold uppercase tracking-widest mt-4">
                ✓ You have reached the end of the catalog
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
