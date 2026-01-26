const TermsAndConditions = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative w-full py-20 md:py-32 bg-section-blue overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 drop-shadow-lg">
            Terms & Conditions
          </h1>
          <div className="w-24 h-1 bg-white/60 mx-auto rounded-full" />
        </div>
      </section>

      {/* Content Section */}
      <section className="py-16 px-4 bg-section-blue">
        <div className="max-w-3xl mx-auto">
          <div className="space-y-8 text-white/90">
            <div>
              <h2 className="text-xl font-semibold text-white mb-3">1. Contest Overview</h2>
              <p>
                The Little Stars Kiddies is a voting competition for children. Participants can register their children 
                and collect votes from supporters. Each vote costs ₦50.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">2. Eligibility</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>Children must be under 10 years old to participate.</li>
                <li>Parents or guardians must register on behalf of their children.</li>
                <li>Each child can only be registered once.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">3. Voting Rules</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>Each vote costs ₦50.</li>
                <li>There is no limit to the number of votes a person can purchase.</li>
                <li>All votes are final and non-refundable.</li>
                <li>Votes are counted automatically and displayed on the leaderboard in real-time.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">4. Prizes</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>1st Place: ₦4,000,000</li>
                <li>2nd Place: ₦2,000,000</li>
                <li>3rd Place: ₦1,000,000</li>
                <li>4th & 5th Place: Compensation prizes</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">5. Payment</h2>
              <p>
                All payments are processed securely through Paystack. We do not store any payment card information.
                By making a payment, you agree to Paystack's terms of service.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">6. Privacy</h2>
              <p>
                We collect and store information provided during registration including child's name, age, and photo.
                This information is used solely for the purpose of the contest and will not be shared with third parties
                without consent.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">7. Disqualification</h2>
              <p>
                The organizers reserve the right to disqualify any participant found engaging in fraudulent activities,
                including but not limited to fake votes, multiple registrations, or any form of manipulation.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">8. Changes to Terms</h2>
              <p>
                We reserve the right to modify these terms and conditions at any time. Participants will be notified
                of any significant changes.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white mb-3">9. Contact</h2>
              <p>
                For any questions or concerns regarding the contest, please contact the organizers through the
                official channels provided on the website.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default TermsAndConditions;
