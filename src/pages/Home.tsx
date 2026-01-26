import { Link } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { CountdownTimer, useContestStartDate } from "@/components/CountdownTimer";
import { Skeleton } from "@/components/ui/skeleton";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, CarouselApi } from "@/components/ui/carousel";
import { Trophy, Medal, Award } from "lucide-react";
import heroImage from "@/assets/kids-playing-blocks.jpg";

// Gallery images for carousel
import girlAfricanDress from "@/assets/gallery/girl-african-dress.jpeg";
import boyTraditional from "@/assets/gallery/boy-traditional.jpeg";
import boyWhiteOutfit from "@/assets/gallery/boy-white-outfit.jpeg";
import babyBlueBalloons from "@/assets/gallery/baby-blue-balloons.jpeg";
import boyBlackAgbada from "@/assets/gallery/boy-black-agbada.jpeg";
import boyWhiteGoldAgbada from "@/assets/gallery/boy-white-gold-agbada.jpeg";
import boyHeadwrap from "@/assets/gallery/boy-headwrap.jpeg";
import boyWhiteCap from "@/assets/gallery/boy-white-cap.jpeg";
import boyBlueCap from "@/assets/gallery/boy-blue-cap.jpeg";
import girlBlueAnkara from "@/assets/gallery/girl-blue-ankara.jpeg";

const contestants = [
  { name: "Adaeze", image: girlAfricanDress },
  { name: "Chukwuemeka", image: boyTraditional },
  { name: "Tunde", image: boyWhiteOutfit },
  { name: "Emmanuel", image: babyBlueBalloons },
  { name: "Oluwaseun", image: boyBlackAgbada },
  { name: "Chisom", image: boyWhiteGoldAgbada },
  { name: "Ibrahim", image: boyHeadwrap },
  { name: "Kelechi", image: boyWhiteCap },
  { name: "Adebayo", image: boyBlueCap },
  { name: "Chiamaka", image: girlBlueAnkara },
];

// Preload all images on mount
const preloadImages = (images: string[]): Promise<void[]> => {
  return Promise.all(
    images.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Resolve even on error to not block
          img.src = src;
        })
    )
  );
};

const OptimizedImage = ({ 
  src, 
  alt, 
  className,
  onLoadComplete
}: { 
  src: string; 
  alt: string; 
  className?: string;
  onLoadComplete?: () => void;
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const retryCount = useRef(0);
  
  const handleLoad = useCallback(() => {
    setLoaded(true);
    setError(false);
    onLoadComplete?.();
  }, [onLoadComplete]);

  const handleError = useCallback(() => {
    if (retryCount.current < 3) {
      retryCount.current += 1;
      // Retry loading with cache bust
      const imgElement = document.querySelector(`img[src="${src}"]`) as HTMLImageElement;
      if (imgElement) {
        imgElement.src = `${src}?retry=${retryCount.current}`;
      }
    } else {
      setError(true);
      onLoadComplete?.(); // Don't block carousel
    }
  }, [src, onLoadComplete]);
  
  return (
    <div className="relative w-full h-full">
      {!loaded && !error && <Skeleton className="absolute inset-0 w-full h-full" />}
      {error && (
        <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        onLoad={handleLoad}
        onError={handleError}
        onContextMenu={(e) => e.preventDefault()}
        draggable={false}
        className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      />
    </div>
  );
};

const Home = () => {
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [heroError, setHeroError] = useState(false);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const heroRetryCount = useRef(0);
  const { formattedDate } = useContestStartDate();

  // Preload only the hero image for faster initial display
  useEffect(() => {
    const img = new Image();
    img.src = heroImage;
  }, []);

  const handleHeroLoad = () => setHeroLoaded(true);
  
  const handleHeroError = () => {
    if (heroRetryCount.current < 3) {
      heroRetryCount.current += 1;
      setHeroError(true);
      setTimeout(() => setHeroError(false), 100);
    } else {
      setHeroError(true);
    }
  };
  
  return (
    <div className="min-h-screen">
      {/* Hero Banner */}
      <section className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden bg-black">
        {!heroLoaded && !heroError && <Skeleton className="absolute inset-0 w-full h-full bg-black" />}
        {heroError && (
          <div className="absolute inset-0 w-full h-full bg-section-blue flex items-center justify-center">
            <span className="text-muted-foreground">Loading image...</span>
          </div>
        )}
        <img
          src={heroError && heroRetryCount.current < 3 ? `${heroImage}?retry=${heroRetryCount.current}` : heroImage}
          alt="Happy family - Little Stars Kiddies"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onLoad={handleHeroLoad}
          onError={handleHeroError}
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
          className={`w-full h-full object-cover object-center blur-[2px] ${heroLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <h1 className="text-4xl md:text-6xl font-bold text-white drop-shadow-lg mb-4">
            Little Stars Kiddies
          </h1>
          <p className="text-lg md:text-xl text-white/90 drop-shadow-md max-w-2xl">
            Celebrating the brilliance of children across Nigeria!
          </p>
        </div>
      </section>

      {/* Countdown & Actions */}
      <section className="py-12 px-4 bg-section-blue">
        <div className="max-w-3xl mx-auto text-center">
          <CountdownTimer variant="dark" />

          <div className="flex flex-col sm:flex-row justify-center gap-4 mt-8">
            <Link
              to="/register"
              className="bg-white text-section-blue px-6 py-3 rounded font-medium hover:bg-gray-100 transition"
            >
              Register Your Child
            </Link>
            <Link
              to="/leaderboard"
              className="border border-white/30 text-white px-6 py-3 rounded font-medium hover:bg-white/10 transition"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Contestants Carousel */}
      <section className="py-12 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-10 text-white">
            Our Little Stars
          </h2>
          <Carousel
            opts={{
              align: "start",
              loop: true,
            }}
            setApi={setCarouselApi}
            className="w-full"
          >
            <CarouselContent className="-ml-2 md:-ml-4">
              {contestants.map((contestant) => (
                <CarouselItem key={contestant.name} className="pl-2 md:pl-4 basis-1/2 md:basis-1/3 lg:basis-1/4">
                  <div className="text-center group">
                    <div className="aspect-square overflow-hidden rounded-xl shadow-lg mb-3 bg-white">
                      <OptimizedImage
                        src={contestant.image}
                        alt={contestant.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <p className="font-semibold text-white">{contestant.name}</p>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="hidden sm:flex -left-4 bg-white/20 border-white/30 text-white hover:bg-white/30" />
            <CarouselNext className="hidden sm:flex -right-4 bg-white/20 border-white/30 text-white hover:bg-white/30" />
          </Carousel>
        </div>
      </section>

      {/* Fun Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-3xl mx-auto text-left">
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-left text-white">Join the Fun!</h2>
          <div className="space-y-4 text-lg leading-relaxed">
            <p className="text-white/90">
              Little Stars Kiddies is more than just a competition; it's a celebration of every child's unique sparkle! 
              Watch your little one shine as they gather votes from family, friends, and supporters across Nigeria.
            </p>
            <p className="text-white/90">
              Every vote is a cheer, every share spreads the joy, and every participant is already a winner in our hearts. 
              This is your chance to create unforgettable memories and show the world just how special your child is.
            </p>
            <p className="font-semibold text-white">
              Ready to let your little star shine? Register today and let the fun begin! ✨
            </p>
          </div>
        </div>
      </section>

      {/* Prizes Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3 text-white">Win Amazing Prizes</h2>
            <p className="text-white/80">Top performers take home incredible rewards!</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* 1st Place */}
            <div className="md:col-span-1 md:order-2">
              <div className="relative bg-white/10 border-2 border-white/40 rounded-2xl p-6 text-center shadow-lg transform md:-translate-y-4 backdrop-blur-sm">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <div className="bg-yellow-400 rounded-full p-3 shadow-md">
                    <Trophy className="w-8 h-8 text-yellow-900" />
                  </div>
                </div>
                <div className="mt-6">
                  <span className="text-white/70 font-medium text-sm uppercase tracking-wide">1st Place</span>
                  <div className="text-4xl md:text-5xl font-bold text-white mt-2 mb-1">₦4M</div>
                  <span className="text-white/70 text-sm">Gold</span>
                </div>
              </div>
            </div>
            
            {/* 2nd Place */}
            <div className="md:order-1">
              <div className="bg-white/10 border border-white/30 rounded-2xl p-6 text-center shadow-md h-full flex flex-col justify-center backdrop-blur-sm">
                <div className="bg-gray-300 rounded-full p-3 w-fit mx-auto mb-4">
                  <Medal className="w-6 h-6 text-gray-600" />
                </div>
                <span className="text-white/70 font-medium text-sm uppercase tracking-wide">2nd Place</span>
                <div className="text-3xl md:text-4xl font-bold text-white mt-2 mb-1">₦2M</div>
                <span className="text-white/70 text-sm">Silver</span>
              </div>
            </div>
            
            {/* 3rd Place */}
            <div className="md:order-3">
              <div className="bg-white/10 border border-white/30 rounded-2xl p-6 text-center shadow-md h-full flex flex-col justify-center backdrop-blur-sm">
                <div className="bg-amber-600 rounded-full p-3 w-fit mx-auto mb-4">
                  <Award className="w-6 h-6 text-amber-100" />
                </div>
                <span className="text-white/70 font-medium text-sm uppercase tracking-wide">3rd Place</span>
                <div className="text-3xl md:text-4xl font-bold text-white mt-2 mb-1">₦1M</div>
                <span className="text-white/70 text-sm">Bronze</span>
              </div>
            </div>
          </div>
          
          {/* 4th & 5th Place */}
          <div className="bg-white/10 border border-white/30 rounded-xl p-6 text-center backdrop-blur-sm">
            <span className="font-semibold text-lg text-white">4th & 5th Place</span>
            <p className="text-white/70 mt-1">Special compensation packages for our runners-up</p>
          </div>
        </div>
      </section>

      {/* Steps to Win Section - Blue */}
      <section className="py-16 px-4 bg-section-blue text-section-blue-foreground">
        <div className="max-w-3xl mx-auto text-left">
          <h2 className="text-3xl md:text-4xl font-bold mb-8 text-left">Steps to Win</h2>
          <div className="space-y-4 text-lg leading-relaxed">
            <p>
              Gather support from your loved ones friends, family, and well-wishers and encourage them to vote for your child. 
              Each vote costs just ₦50, and there's no limit to how many votes you can collect!
            </p>
            <p>
              The child who receives the most votes at the end of the contest will be crowned the ultimate winner. 
              So spread the word, share your child's profile, and let the votes roll in!
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 px-4 bg-section-blue">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8 text-white">How It Works</h2>
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-white text-section-blue flex items-center justify-center flex-shrink-0 font-bold">
                1
              </div>
              <p className="text-white/85">Register your child with their details and photo.</p>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-white text-section-blue flex items-center justify-center flex-shrink-0 font-bold">
                2
              </div>
              <p className="text-white/85">Get a unique link for your child's profile - copy and keep this safe!</p>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-white text-section-blue flex items-center justify-center flex-shrink-0 font-bold">
                3
              </div>
              <p className="text-white/85">Share the link with family and friends to vote.</p>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-white text-section-blue flex items-center justify-center flex-shrink-0 font-bold">
                4
              </div>
              <p className="text-white/85">Each vote costs ₦50. Multiple votes allowed!</p>
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-white/80">
            💡 <span className="text-yellow-300 font-semibold">Click on a contestant name</span> on the leaderboard to vote for them!
          </p>
        </div>
      </section>

      {/* Register and Join Section - Blue */}
      <section className="py-16 px-4 bg-section-blue text-section-blue-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Register and Join the Stars</h2>
          <div className="space-y-4 text-lg leading-relaxed mb-8">
            <p>
              Getting started is easy! Simply click the "Register Now" button below to sign up your child for the Little Stars Kiddies.
              You can also reach out to us via WhatsApp for assistance with registration.
            </p>
            <p>
              Once your registration is complete, remember that voting opens on <span className="font-bold">{formattedDate}</span>.
              Start rallying your supporters early and get ready for an exciting journey!
            </p>
          </div>
          <Link
            to="/register"
            className="inline-block bg-white text-section-blue px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition shadow-lg"
          >
            Register Now
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 bg-section-blue text-section-blue-foreground border-t border-white/20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-lg font-semibold mb-4 uppercase tracking-wide">Contact</h3>
            <div className="flex justify-center gap-6 mb-6">
              <a href="https://www.facebook.com/profile.php?id=100076971684775&mibextid=ZbWKwL" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="mailto:littlestarskiddies.org@gmail.com" className="hover:text-primary transition">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </a>
            </div>
            <nav className="flex flex-wrap justify-center gap-4 text-sm">
              <Link to="/leaderboard" className="hover:text-primary transition">Vote</Link>
              <Link to="/terms" className="hover:text-primary transition">Terms & Conditions</Link>
            </nav>
          </div>
          <div className="text-center text-sm opacity-80 border-t border-white/20 pt-6">
            <p className="uppercase tracking-wide mb-1">Copyright</p>
            <p>Little Stars Kiddies 2026</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
