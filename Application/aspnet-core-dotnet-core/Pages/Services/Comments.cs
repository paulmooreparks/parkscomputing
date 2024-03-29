﻿using System;
using System.Collections.Generic;
using SmartSam.Comments.Lib;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class Comments {
        public bool Enabled { get; set; } = false;
        public bool Allowed { get; set; } = false;
        public bool Posted { get; set; } = false;
        public Exception? Exception { get; set; } = null;
        public CommentForm? CommentForm { get; set; } = null;
        public List<CommentResponse> CommentResponseList { get; set; } = new List<CommentResponse>();
    }
}
