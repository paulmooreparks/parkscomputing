using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace SmartSam.Comments.Lib {
    public enum CommentStatus {
        [Description("Draft that has not been submitted")]
        Draft = 0,

        [Description("Submitted but not yet approved by moderator")]
        AwaitingModeration = 1,

        [Description("Moderated but requires edit before approval")]
        AwaitingEdit = 2,

        [Description("Approved for publishing")]
        Approved = 3,

        [Description("Previously published but now under review")]
        UnderReview = 4,

        [Description("Rejected during approval or review process")]
        Rejected = 5,

        [Description("Archived and no longer published")]
        Archived = 6,

        [Description("Rejected as spam")]
        Spam = 7,

        [Description("Deleted")]
        Deleted = 8,
    }
}
