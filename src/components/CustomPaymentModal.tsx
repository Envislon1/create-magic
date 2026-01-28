import { useState } from "react";
import { X, Loader2, CheckCircle, XCircle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateReference, VOTE_PRICE_NAIRA, PAYSTACK_PUBLIC_KEY } from "@/lib/paystack";
import { supabase } from "@/integrations/supabase/client";

interface CustomPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestantId: string;
  contestantName: string;
  onVoteSuccess: () => void;
}

type PaymentStep = "input" | "processing" | "success" | "failed";

const formatCurrency = (value: number): string => {
  return value.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export function CustomPaymentModal({
  isOpen,
  onClose,
  contestantId,
  contestantName,
  onVoteSuccess,
}: CustomPaymentModalProps) {
  const [rawAmount, setRawAmount] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<PaymentStep>("input");
  const [errorMessage, setErrorMessage] = useState("");
  const { toast } = useToast();

  const numericAmount = parseInt(rawAmount) || 0;
  const voteCount = Math.floor(numericAmount / VOTE_PRICE_NAIRA);
  const validAmount = voteCount * VOTE_PRICE_NAIRA;

  const resetModal = () => {
    setStep("input");
    setRawAmount("");
    setEmail("");
    setErrorMessage("");
  };

  const handleClose = () => {
    if (step === "processing") return; // Prevent closing during payment
    resetModal();
    onClose();
  };

  const handlePayment = () => {
    if (!email) {
      toast({ title: "Please enter your email", variant: "destructive" });
      return;
    }

    if (voteCount < 1) {
      toast({ title: `Minimum amount is ₦${VOTE_PRICE_NAIRA}`, variant: "destructive" });
      return;
    }

    setStep("processing");
    const reference = generateReference();
    const amountInKobo = validAmount * 100;

    try {
      if (!(window as any).PaystackPop) {
        throw new Error("Payment system not loaded. Please refresh the page.");
      }

      if (!PAYSTACK_PUBLIC_KEY) {
        throw new Error("Payment system not configured. Please contact support.");
      }

      const handler = (window as any).PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: email,
        amount: amountInKobo,
        currency: "NGN",
        ref: reference,
        metadata: {
          contestant_id: contestantId,
          vote_count: voteCount,
        },
        callback: function (response: { reference: string }) {
          const verifyPayment = async () => {
            try {
              const { data, error } = await supabase.functions.invoke("verify-payment", {
                body: {
                  reference: response.reference,
                  contestant_id: contestantId,
                  vote_count: voteCount,
                  voter_email: email,
                },
              });

              if (error) throw error;

              if (data.success) {
                setStep("success");
                onVoteSuccess();
              } else {
                setErrorMessage(data.message || "Vote failed");
                setStep("failed");
              }
            } catch (error: any) {
              console.error("Verification error:", error);
              setErrorMessage("Payment verification failed. Please contact support.");
              setStep("failed");
            }
          };
          verifyPayment();
        },
        onClose: () => {
          if (step === "processing") {
            setStep("input");
          }
        },
      });

      handler.openIframe();
    } catch (error: any) {
      console.error("Paystack error:", error);
      setErrorMessage(error.message || "Could not initialize payment. Please try again.");
      setStep("failed");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-section-blue w-full max-w-md mx-4 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/20">
          <h2 className="text-xl font-bold text-white">
            Vote for {contestantName}
          </h2>
          {step !== "processing" && (
            <button
              onClick={handleClose}
              className="text-white/70 hover:text-white transition p-1"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {step === "input" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-2 text-white/90">Your Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/10 border border-white/30 text-white placeholder:text-white/50 p-3 rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent transition-all"
                  placeholder="email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm mb-2 text-white/90">
                  Amount - Minimum ₦{formatCurrency(VOTE_PRICE_NAIRA)}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70">₦</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={rawAmount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, "");
                      setRawAmount(value);
                    }}
                    className="w-full bg-white/10 border border-white/30 text-white placeholder:text-white/50 p-3 pl-8 rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent transition-all"
                    placeholder="0"
                  />
                </div>
                {numericAmount > 0 && (
                  <p className="text-sm text-white/70 mt-2">
                    = ₦{formatCurrency(numericAmount)}
                  </p>
                )}
              </div>

              {numericAmount > 0 && (
                <div className="bg-white/10 rounded-lg p-4 border border-white/20">
                  <p className="text-white">
                    ₦{formatCurrency(validAmount)} ={" "}
                    <strong className="text-white text-lg">
                      {voteCount} vote{voteCount !== 1 ? "s" : ""}
                    </strong>
                  </p>
                  <p className="text-white/70 text-sm mt-1">
                    ₦{formatCurrency(VOTE_PRICE_NAIRA)} per vote
                  </p>
                  {numericAmount !== validAmount && numericAmount >= VOTE_PRICE_NAIRA && (
                    <p className="text-white/60 text-xs mt-2">
                      ₦{formatCurrency(numericAmount - validAmount)} will not be charged (partial vote)
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handlePayment}
                disabled={voteCount < 1}
                className="w-full bg-white text-section-blue p-4 rounded-lg font-bold text-lg disabled:opacity-50 hover:bg-white/90 transition-colors shadow-lg flex items-center justify-center gap-2"
              >
                <CreditCard className="w-5 h-5" />
                Pay ₦{formatCurrency(validAmount)}
              </button>
            </div>
          )}

          {step === "processing" && (
            <div className="text-center py-12">
              <Loader2 className="w-16 h-16 text-white animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Processing Payment</h3>
              <p className="text-white/70">Please complete the payment in the Paystack popup...</p>
            </div>
          )}

          {step === "success" && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-12 h-12 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Payment Successful!</h3>
              <p className="text-white/70 mb-6">
                You've added <strong className="text-white">{voteCount} vote{voteCount !== 1 ? "s" : ""}</strong> for {contestantName}!
              </p>
              <button
                onClick={handleClose}
                className="bg-white text-section-blue px-8 py-3 rounded-lg font-bold hover:bg-white/90 transition-colors shadow-lg"
              >
                Done
              </button>
            </div>
          )}

          {step === "failed" && (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-12 h-12 text-red-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Payment Failed</h3>
              <p className="text-white/70 mb-6">{errorMessage}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setStep("input")}
                  className="bg-white text-section-blue px-6 py-3 rounded-lg font-bold hover:bg-white/90 transition-colors shadow-lg"
                >
                  Try Again
                </button>
                <button
                  onClick={handleClose}
                  className="bg-white/20 text-white px-6 py-3 rounded-lg font-bold hover:bg-white/30 transition-colors border border-white/30"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
