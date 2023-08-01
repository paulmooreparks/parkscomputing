using System;
using System.Collections.Generic;
using SmartSam.Comments.Lib;
using Microsoft.Extensions.Hosting;

namespace aspnet_core_dotnet_core.Pages.Services {
    public class CommentService : ICommentService {
        private IHostEnvironment Environment { get; set; }
        public CommentService(IHostEnvironment environment) {
            Environment = environment;
        }

        Comments ICommentService.GetComments(string pageId, bool enabled, bool allowed) {
            List<Comment> commentList = null;
            
            if (enabled) {
                commentList = new List<Comment>() {
                    new Comment { 
                        PageId = pageId,
                        Id = "1",
                        CreateDateTime = DateTime.Parse("15 December 2022 10:54"),
                        Name = "Paul", 
                        Email = "paul@smartsam.com",
                        Title = "Hello, World",
                        CommentText = "Hi there!"
                    },
                    new Comment {
                        PageId = pageId,
                        Id = "1",
                        CreateDateTime = DateTime.Parse("15 December 2022 10:54"),
                        Name = "Larry",
                        Email = "paul@smartsam.com",
                        Title = "Whee dog!",
                        CommentText = "Gitrdone!"
                    }
                };
            }

            var comments = new Comments() {
                Enabled = enabled,
                Allowed = allowed,
                CommentList = commentList
            };

            return comments;
        }
    }
}
