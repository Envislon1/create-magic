import { Link } from "react-router-dom";
import { Star, Heart, Trophy, Users } from "lucide-react";

// Gallery images
import girlAfricanDress from "@/assets/gallery/girl-african-dress.jpeg";
import boyTraditional from "@/assets/gallery/boy-traditional.jpeg";
import heroFamily from "@/assets/hero-family.webp";
import boyReading from "@/assets/gallery/boy-reading.jpeg";
import siblingsPlaying from "@/assets/gallery/siblings-playing.jpeg";
import happyBoyBooks from "@/assets/gallery/happy-boy-books.jpeg";
import babyBlueBalloons from "@/assets/gallery/baby-blue-balloons.jpeg";
import kidsPuzzle from "@/assets/gallery/kids-puzzle.jpeg";
import boyWhiteOutfit from "@/assets/gallery/boy-white-outfit.jpeg";
import smilingToddler from "@/assets/gallery/smiling-toddler.jpeg";

const galleryImages = [
  { src: girlAfricanDress, alt: "Beautiful girl in African print dress" },
  { src: boyTraditional, alt: "Boy in traditional African outfit" },
  { src: boyWhiteOutfit, alt: "Stylish boy in white outfit" },
  { src: smilingToddler, alt: "Happy smiling toddler" },
  { src: happyBoyBooks, alt: "Excited boy with books" },
];

const activityImages = [
  { src: heroFamily, alt: "Happy family together" },
  { src: siblingsPlaying, alt: "Siblings playing together" },
  { src: kidsPuzzle, alt: "Children solving puzzles" },
  { src: boyReading, alt: "Boy enjoying story time" },
];

const About = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section with Featured Image */}
      <section className="relative w-full py-16 md:py-24 bg-section-blue overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-transparent" />
        <div className="relative max-w-5xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="text-center md:text-left">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 drop-shadow-lg">
                About Us
              </h1>
              <div className="w-24 h-1 bg-white/60 mx-auto md:mx-0 rounded-full mb-6" />
              <p className="text-white/90 text-lg leading-relaxed">
                Celebrating the beauty, innocence, and charm of every child across Nigeria.
              </p>
            </div>
            <div className="flex justify-center">
              <div className="relative">
                <img
                  src={babyBlueBalloons}
                  alt="Little Star"
                  className="w-64 h-64 md:w-72 md:h-72 object-cover rounded-full border-4 border-white/30 shadow-2xl"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                />
                <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-3 shadow-lg">
                  <Star className="w-8 h-8 text-primary" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Star Gallery Section */}
      <section className="py-12 px-4 bg-section-blue">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-white">
            Our Little Stars Gallery
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {galleryImages.map((image, index) => (
              <div
                key={index}
                className="aspect-square overflow-hidden rounded-xl shadow-lg group bg-white/10"
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Celebrating Beauty Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="order-2 md:order-1">
              <img
                src={girlAfricanDress}
                alt="Beautiful little star"
                className="w-full max-w-sm mx-auto rounded-2xl shadow-xl border-4 border-white/20"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
              />
            </div>
            <div className="order-1 md:order-2 text-center md:text-left">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                CELEBRATING THE BEAUTY OF CHILDHOOD
              </h2>
              <h3 className="text-xl md:text-2xl font-semibold text-white/90 mb-6">
                EVERY CHILD IS A STAR
              </h3>
              <div className="space-y-4 text-white/85 text-lg leading-relaxed">
                <p>
                  The world deserves to witness your child's radiant beauty! That's exactly why we're here...
                </p>
                <p>
                  Little Stars Kiddies is a passionate organization dedicated to empowering beautiful children 
                  and giving them a platform to shine.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Our Mission Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-white">
            Showcasing the Adorable
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 shadow-md border border-white/20">
              <Star className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold mb-3 text-white">Our Purpose</h3>
              <p className="text-white/85">
                Little Stars Kiddies exists to showcase your adorable little one on the grandest stage of them all. 
                We celebrate the beauty, innocence, and charm that every child naturally possesses.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 shadow-md border border-white/20">
              <Heart className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold mb-3 text-white">What We Believe</h3>
              <p className="text-white/85">
                At Little Stars, we believe children are the rarest of treasures and deserve to be treated as such. 
                Your child is too precious to remain hidden—our goal is to display their cuteness to the world.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Activity Gallery Section */}
      <section className="py-12 px-4 bg-section-blue">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-white">
            Every Moment is Precious
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {activityImages.map((image, index) => (
              <div
                key={index}
                className="aspect-[4/3] overflow-hidden rounded-xl shadow-lg group bg-white/10"
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contest Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="text-center md:text-left">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
                Little Stars Online Kiddies Contest
              </h2>
              <p className="text-white/85 text-lg leading-relaxed">
                The Little Stars Online Kiddies Contest is designed to magnify and celebrate the beauty of your 
                child on the grandest spotlight, while creating cherished moments for both child and parent. 
                We're here to bring your hopes and dreams for your little cutie to life!
              </p>
            </div>
            <div className="flex justify-center">
              <img
                src={boyTraditional}
                alt="Contest participant"
                className="w-full max-w-xs rounded-2xl shadow-xl border-4 border-white/20"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-white">
            What's In It For You?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white/10 backdrop-blur text-white rounded-xl p-6 text-center border border-white/20">
              <Trophy className="w-12 h-12 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-3">Become the Face of Little Stars</h3>
              <p className="text-white/85">
                The winner of our online kiddies contest becomes a brand ambassador, receiving 
                amazing endorsement opportunities and exclusive deals.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur text-white rounded-xl p-6 text-center border border-white/20">
              <Star className="w-12 h-12 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-3">Win Exciting Cash Prizes</h3>
              <p className="text-white/85">
                Our top contestants win incredible cash prizes—up to ₦4 Million for first place, 
                with generous rewards for runners-up too!
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur text-white rounded-xl p-6 text-center border border-white/20">
              <Users className="w-12 h-12 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-3">Build Your Child's Portfolio</h3>
              <p className="text-white/85">
                Enter the world of modelling and portfolio development with guidance from our 
                professional team. Your child's star journey begins here!
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur text-white rounded-xl p-6 text-center border border-white/20">
              <Heart className="w-12 h-12 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-3">Create Lasting Memories</h3>
              <p className="text-white/85">
                Beyond prizes, you'll create unforgettable memories celebrating your child's 
                unique beauty with family and friends nationwide.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="flex justify-center order-2 md:order-1">
              <img
                src={happyBoyBooks}
                alt="Happy little star"
                className="w-full max-w-xs rounded-2xl shadow-xl border-4 border-white/20"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
              />
            </div>
            <div className="text-center md:text-left order-1 md:order-2">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
                Ready to Let Your Star Shine?
              </h2>
              <p className="text-white/85 text-lg mb-8">
                Join thousands of parents who have already registered their little stars. 
                Don't let your child's beauty remain hidden—share it with the world!
              </p>
              <Link
                to="/register"
                className="inline-block bg-white text-section-blue px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition shadow-lg"
              >
                Register Your Child Now
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default About;
