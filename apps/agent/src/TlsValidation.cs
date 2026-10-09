using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace MasterSupport.Agent;

public static class TlsValidation
{
    public static bool ValidateWithTestCa(X509Certificate? certificate, X509Chain? _, SslPolicyErrors errors, string caPath)
    {
        if (certificate is null || (errors & SslPolicyErrors.RemoteCertificateNameMismatch) != 0 ||
            (errors & SslPolicyErrors.RemoteCertificateNotAvailable) != 0) return false;
        using var ca = X509Certificate2.CreateFromPem(File.ReadAllText(caPath));
        using var leaf = new X509Certificate2(certificate);
        using var validationChain = new X509Chain();
        validationChain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        validationChain.ChainPolicy.CustomTrustStore.Add(ca);
        validationChain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        validationChain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        return validationChain.Build(leaf);
    }
}
