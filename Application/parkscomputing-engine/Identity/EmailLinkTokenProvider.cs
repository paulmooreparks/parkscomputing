using System;

using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Tokens for emailed sign-in links and server-issued enrollment links, valid
/// for fifteen minutes (A4). A token carries the account's security stamp, and
/// the stamp is renewed as soon as one is used, so each works once.
/// </summary>
public sealed class EmailLinkTokenProvider<TUser> : DataProtectorTokenProvider<TUser> where TUser : class {
    public const string ProviderName = "EmailLink";
    public const string SignInPurpose = "SignIn";
    public const string EnrollPurpose = "Enroll";

    public EmailLinkTokenProvider(IDataProtectionProvider dataProtectionProvider,
        IOptions<EmailLinkTokenProviderOptions> options,
        ILogger<DataProtectorTokenProvider<TUser>> logger)
        : base(dataProtectionProvider, options, logger) { }
}

public sealed class EmailLinkTokenProviderOptions : DataProtectionTokenProviderOptions {
    public EmailLinkTokenProviderOptions() {
        Name = EmailLinkTokenProvider<object>.ProviderName;
        TokenLifespan = TimeSpan.FromMinutes(15);
    }
}
