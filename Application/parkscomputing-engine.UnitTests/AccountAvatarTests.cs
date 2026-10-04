using System;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>Profile pictures are known by their own leading bytes, never by
/// a name or type the request claims (Identity/AccountAvatars.cs).</summary>
[TestClass]
public sealed class AccountAvatarTests {
    private static byte[] Png => new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0 };
    private static byte[] Jpeg => new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0 };
    private static byte[] Webp => "RIFF"u8.ToArray().Concat(new byte[] { 1, 2, 3, 4 }).Concat("WEBPVP8 "u8.ToArray()).ToArray();

    [TestMethod]
    public void PicturesAreKnownByTheirBytes() {
        Assert.AreEqual("image/png", AccountAvatars.TypeOf(Png));
        Assert.AreEqual("image/jpeg", AccountAvatars.TypeOf(Jpeg));
        Assert.AreEqual("image/webp", AccountAvatars.TypeOf(Webp));
    }

    [TestMethod]
    public void AnythingElseIsRefused() {
        Assert.IsNull(AccountAvatars.TypeOf("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"u8));
        Assert.IsNull(AccountAvatars.TypeOf("<html><script>alert(1)</script>"u8));
        Assert.IsNull(AccountAvatars.TypeOf("GIF89a"u8));
        Assert.IsNull(AccountAvatars.TypeOf("RIFF1234WAVE"u8));
        Assert.IsNotNull(AccountAvatars.Refusal("<svg/>"u8));
    }

    [TestMethod]
    public void EmptyAndOversizedPicturesAreRefused() {
        Assert.AreEqual(AccountAvatars.Missing, AccountAvatars.Refusal(ReadOnlySpan<byte>.Empty));
        var big = new byte[AccountAvatars.MaxBytes + 1]; Png.CopyTo(big, 0);
        Assert.AreEqual(AccountAvatars.TooLarge, AccountAvatars.Refusal(big));
        var fits = new byte[AccountAvatars.MaxBytes]; Png.CopyTo(fits, 0);
        Assert.IsNull(AccountAvatars.Refusal(fits));
    }
}
