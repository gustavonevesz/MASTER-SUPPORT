using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace MasterSupport.Agent;

public static class TestCertificateGenerator
{
    public static void Generate(string directory)
    {
        Directory.CreateDirectory(directory);
        using var caKey = RSA.Create(3072);
        var caRequest = new CertificateRequest("CN=Master Support Test CA", caKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        caRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        caRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        using var ca = caRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddYears(-1), DateTimeOffset.UtcNow.AddYears(2));
        File.WriteAllText(Path.Combine(directory, "ca.pem"), ca.ExportCertificatePem());
        CreateServer(directory, "server", ca, "localhost", true, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(7));
        CreateServer(directory, "wrong-host", ca, "wrong.invalid", false, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(7));
        CreateServer(directory, "expired", ca, "localhost", true, DateTimeOffset.UtcNow.AddDays(-10), DateTimeOffset.UtcNow.AddDays(-2));
    }
    private static void CreateServer(string directory, string name, X509Certificate2 ca, string dns, bool loopback,
        DateTimeOffset notBefore, DateTimeOffset notAfter)
    {
        using var key = RSA.Create(3072);
        var request = new CertificateRequest($"CN={dns}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new("1.3.6.1.5.5.7.3.1") }, true));
        var san = new SubjectAlternativeNameBuilder(); san.AddDnsName(dns); if (loopback) san.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(san.Build());
        var serial = RandomNumberGenerator.GetBytes(16);
        using var cert = request.Create(ca, notBefore, notAfter, serial);
        File.WriteAllText(Path.Combine(directory, $"{name}-leaf.pem"), cert.ExportCertificatePem());
        File.WriteAllText(Path.Combine(directory, $"{name}-cert.pem"), cert.ExportCertificatePem() + Environment.NewLine + ca.ExportCertificatePem());
        File.WriteAllText(Path.Combine(directory, $"{name}-key.pem"), key.ExportPkcs8PrivateKeyPem());
    }
}
