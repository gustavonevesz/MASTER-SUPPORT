using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using MasterSupport.Agent;

namespace MasterSupport.Agent.Tests;

[TestClass]
public sealed class TlsValidationTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"master-support-certs-{Guid.NewGuid():N}");
    public TlsValidationTests() => TestCertificateGenerator.Generate(_directory);

    [TestMethod]
    public void ExplicitTestCaAcceptsValidChainAndRejectsWrongNameAndExpiry()
    {
        var ca = Path.Combine(_directory, "ca.pem");
        using var valid = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(_directory, "server-leaf.pem")));
        using var expired = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(_directory, "expired-leaf.pem")));
        Assert.IsTrue(TlsValidation.ValidateWithTestCa(valid, null, SslPolicyErrors.RemoteCertificateChainErrors, ca));
        Assert.IsFalse(TlsValidation.ValidateWithTestCa(valid, null, SslPolicyErrors.RemoteCertificateNameMismatch, ca));
        Assert.IsFalse(TlsValidation.ValidateWithTestCa(expired, null, SslPolicyErrors.RemoteCertificateChainErrors, ca));
    }

    [TestMethod]
    public void UntrustedCaIsRejected()
    {
        var other = Path.Combine(Path.GetTempPath(), $"master-support-other-{Guid.NewGuid():N}"); TestCertificateGenerator.Generate(other);
        try
        {
            using var valid = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(_directory, "server-leaf.pem")));
            Assert.IsFalse(TlsValidation.ValidateWithTestCa(valid, null, SslPolicyErrors.RemoteCertificateChainErrors, Path.Combine(other, "ca.pem")));
        }
        finally { Directory.Delete(other, true); }
    }

    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
}
