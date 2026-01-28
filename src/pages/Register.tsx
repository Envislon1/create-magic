import { useState } from "react";
import { Link } from "react-router-dom";
import { RegistrationForm } from "@/components/RegistrationForm";
import { Copy, Check } from "lucide-react";

const Register = () => {
  const [registeredSlug, setRegisteredSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRegistrationSuccess = (slug: string) => {
    setRegisteredSlug(slug);
  };

  const profileLink = registeredSlug 
    ? `${window.location.origin}/contestant/${registeredSlug}`
    : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(profileLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative w-full py-20 md:py-32 bg-section-blue overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 drop-shadow-lg">
            Register Your Child
          </h1>
          <div className="w-24 h-1 bg-white/60 mx-auto rounded-full" />
        </div>
      </section>

      {/* Content Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-lg mx-auto">
          <p className="text-white/85 text-center mb-8">
            Fill in the details below to enter your child into the contest.
          </p>

          {registeredSlug ? (
            <div className="rounded-xl p-6 bg-white/10 backdrop-blur border border-white/20">
              <h2 className="text-xl font-semibold mb-4 text-center text-white">Registration Successful!</h2>
              
              <div className="bg-destructive/20 border border-destructive/30 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-white mb-1">Important:</p>
                <p className="text-sm text-white/80">
                  Copy and save this link! You will need it to access your child's profile and share it with family and friends for voting.
                </p>
              </div>

              <p className="text-sm text-white/80 mb-2">Your child's unique profile link:</p>
              
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="text"
                  readOnly
                  value={profileLink}
                  className="flex-1 border border-white/30 p-2 rounded-lg bg-white/10 text-sm text-white"
                />
                <button
                  onClick={copyToClipboard}
                  className="border border-white/30 p-2 rounded-lg hover:bg-white/10 transition text-white"
                  title="Copy link"
                >
                  {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <Link
                  to={`/contestant/${registeredSlug}`}
                  className="bg-white text-section-blue px-4 py-2 rounded-lg text-center font-medium hover:bg-gray-100 transition"
                >
                  View Profile
                </Link>
                <button
                  onClick={() => setRegisteredSlug(null)}
                  className="border border-white/30 text-white px-4 py-2 rounded-lg text-center hover:bg-white/10 transition"
                >
                  Register Another Child
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 border border-white/20">
              <RegistrationForm onSuccess={handleRegistrationSuccess} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Register;
